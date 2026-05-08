#!/usr/bin/env python3
"""
Anthropic -> Vertex AI Claude 流式转发代理
直接透传所有参数，只添加 Vertex AI 必需的字段
集成 Langfuse v4 进行 LLM trace 监控
"""

import json
import logging
import os
import time
import argparse
import threading
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, request, Response, stream_with_context
import requests

# ========================
# 配置
# ========================
UPSTREAM_URL = "https://runway.devops.rednote.life/openai/google/anthropic/v1:streamRawPredict"
API_KEY = "f63bb69e30334b25a1b4f18ddf60f393"
LOCAL_PORT = 8080

# Debug 开关：通过环境变量 PROXY_DEBUG=1 或命令行参数 --debug 开启
DEBUG = os.environ.get("PROXY_DEBUG", "0") == "1"

# Langfuse 配置
LANGFUSE_SECRET_KEY = "sk-lf-5d3e81d5-92f1-4eac-b587-3043b658116d"
LANGFUSE_PUBLIC_KEY = "pk-lf-6db24320-9528-4152-940f-d894d7402c26"
LANGFUSE_BASE_URL = "https://xray-langfuse.devops.xiaohongshu.com/langfuse-microapp"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# 后台线程池：用于异步提交 Langfuse 记录，不阻塞流式响应
_langfuse_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="langfuse")

# ========================
# Langfuse 初始化 (v4 API - 基于 OpenTelemetry)
# ========================
langfuse_client = None

try:
    from langfuse import Langfuse

    langfuse_client = Langfuse(
        secret_key=LANGFUSE_SECRET_KEY,
        public_key=LANGFUSE_PUBLIC_KEY,
        host=LANGFUSE_BASE_URL,
    )
    logger.info(f"Langfuse v4 已初始化，服务地址: {LANGFUSE_BASE_URL}")
except ImportError:
    logger.warning("langfuse 包未安装，跳过 Langfuse 集成。请运行: pip install langfuse")
    langfuse_client = None
except Exception as e:
    logger.warning(f"Langfuse 初始化失败: {e}，将继续运行但不记录 trace")
    langfuse_client = None


def _create_langfuse_generation(original_body, original_model):
    """使用 Langfuse v4 start_observation API 创建 generation 追踪

    v4 SDK 已移除旧式 trace()/generation() 方法，改用 start_observation()。
    使用超时保护，避免 Langfuse 服务不稳定时阻塞代理请求。

    Args:
        original_body: 原始请求体
        original_model: 模型名称

    Returns:
        LangfuseGeneration 对象，失败返回 None
    """
    if not langfuse_client:
        return None

    try:
        # 提取请求元信息
        messages = original_body.get("messages", [])
        system_prompt = original_body.get("system", "")
        if isinstance(system_prompt, list):
            system_prompt = "".join(
                item.get("text", "") if isinstance(item, dict) else str(item)
                for item in system_prompt
            )

        # 构建 model_parameters（v4 不接受 None 值，需过滤）
        model_params = {}
        for key in ("max_tokens", "temperature", "top_p", "top_k"):
            val = original_body.get(key)
            if val is not None:
                model_params[key] = val

        # 使用超时保护创建 generation，避免 Langfuse 服务慢时阻塞代理
        result = [None]
        exc = [None]

        def _create():
            try:
                result[0] = langfuse_client.start_observation(
                    name="claude-proxy-completion",
                    as_type="generation",
                    model=original_model,
                    model_parameters=model_params if model_params else None,
                    input={
                        "system": system_prompt if system_prompt else None,
                        "messages": messages,
                    },
                    metadata={
                        "proxy_upstream": UPSTREAM_URL,
                        "source": "claude_proxy",
                    },
                )
            except Exception as e:
                exc[0] = e

        t = threading.Thread(target=_create, daemon=True)
        t.start()
        t.join(timeout=10)  # 最多等 10 秒，超时则放弃

        if t.is_alive():
            logger.warning("创建 Langfuse generation 超时（10s），跳过本次监控")
            return None
        if exc[0]:
            raise exc[0]

        logger.info(f"Langfuse generation 已创建，model={original_model}")
        return result[0]
    except Exception as e:
        logger.warning(f"创建 Langfuse generation 失败: {e}")
        return None


def _finalize_langfuse_generation(generation, output_text, usage_info, error=None, elapsed_ms=0):
    """完成 Langfuse generation 记录（v4 API）

    Args:
        generation: Langfuse v4 LangfuseGeneration 对象
        output_text: 模型输出文本
        usage_info: token 用量信息 dict（含 input_tokens, output_tokens）
        error: 错误信息（可选）
        elapsed_ms: 请求耗时毫秒
    """
    if not generation:
        return

    try:
        # 构建 usage_details（v4 格式）
        usage_details = {}
        input_tokens = usage_info.get("input_tokens")
        output_tokens = usage_info.get("output_tokens")
        if input_tokens is not None:
            usage_details["input"] = int(input_tokens)
        if output_tokens is not None:
            usage_details["output"] = int(output_tokens)

        # 使用 v4 的 update() 方法设置输出信息
        # 注意：必须始终设置 output，即使为空字符串，否则 Langfuse 会显示 undefined
        update_kwargs = {
            "output": output_text if output_text else "(empty response)",
            "metadata": {
                "latency_ms": elapsed_ms,
                "output_length": len(output_text) if output_text else 0,
            },
        }
        if usage_details:
            update_kwargs["usage_details"] = usage_details
        if error:
            update_kwargs["level"] = "ERROR"
            update_kwargs["status_message"] = error

        generation.update(**update_kwargs)

        # 结束 generation span
        generation.end()
        logger.info(
            f"Langfuse generation 已记录完成 (耗时 {elapsed_ms}ms, "
            f"output长度={len(output_text) if output_text else 0})"
        )
    except Exception as e:
        logger.warning(f"Langfuse generation 记录失败: {e}")
        try:
            generation.end()
        except Exception:
            pass


def _async_finalize_langfuse(generation, output_texts, tool_calls, usage_info, error_msg, request_start_time):
    """在后台线程中异步完成 Langfuse 记录

    这个函数会在流式透传结束后被提交到线程池执行，不阻塞客户端响应。

    Args:
        generation: Langfuse generation 对象
        output_texts: 收集到的文本片段列表
        tool_calls: 收集到的工具调用片段列表
        usage_info: token 用量 dict
        error_msg: 错误信息
        request_start_time: 请求开始时间戳
    """
    try:
        # 合并输出：文本 + tool calls 都包含
        parts = []
        text_content = "".join(output_texts)
        tool_content = "".join(tool_calls)
        if text_content:
            parts.append(text_content)
        if tool_content:
            parts.append(tool_content)
        output_text = "\n".join(parts) if parts else ""

        elapsed_ms = int((time.time() - request_start_time) * 1000)

        logger.info(
            f"[Langfuse] 异步记录中，text片段={len(output_texts)}, tool片段={len(tool_calls)}, "
            f"output总长={len(output_text)}, usage={usage_info}, error={error_msg}"
        )

        _finalize_langfuse_generation(
            generation,
            output_text=output_text,
            usage_info=usage_info,
            error=error_msg,
            elapsed_ms=elapsed_ms,
        )

        # flush Langfuse
        if langfuse_client:
            langfuse_client.flush()
    except Exception as e:
        logger.error(f"[Langfuse] 异步记录失败: {e}")




# ========================
# /v1/messages/count_tokens 本地实现
# ========================
# Claude Code 启动期会调用 /v1/messages/count_tokens 估算上下文 token，
# 期望返回简单 JSON: {"input_tokens": <int>}。
# 上游 Vertex AI 的 streamRawPredict 端点不提供该能力，
# 通用代理路由又会把请求当作 messages 推理转发回 SSE 流，
# 导致客户端拿不到 input_tokens 字段而崩溃
# (Cannot read properties of undefined (reading 'input_tokens'))，
# 所以这里做一个本地的粗略估算。
def _estimate_input_tokens(body):
    """根据 Anthropic 请求体估算输入 token 数。

    粗略策略：CJK 字符按 1.5 token/char 计，其他字符按 1 token/3.5 char 计。
    估算结果偏保守（略大于真实值），用于客户端做 context window 判断足够。
    """
    if not isinstance(body, dict):
        return 1

    pieces = []

    # system prompt 可能是 str 或 list[{"type":"text","text":...}]
    system = body.get("system")
    if isinstance(system, str):
        pieces.append(system)
    elif isinstance(system, list):
        for item in system:
            if isinstance(item, dict):
                pieces.append(str(item.get("text", "")))
            else:
                pieces.append(str(item))

    # messages
    for msg in body.get("messages", []) or []:
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if isinstance(content, str):
            pieces.append(content)
        elif isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "text":
                    pieces.append(str(block.get("text", "")))
                elif btype == "tool_use":
                    try:
                        pieces.append(json.dumps(block.get("input", {}), ensure_ascii=False))
                    except Exception:
                        pass
                    pieces.append(str(block.get("name", "")))
                elif btype == "tool_result":
                    tc = block.get("content")
                    if isinstance(tc, str):
                        pieces.append(tc)
                    elif isinstance(tc, list):
                        for sub in tc:
                            if isinstance(sub, dict) and sub.get("type") == "text":
                                pieces.append(str(sub.get("text", "")))
                elif btype in ("image", "document"):
                    # 多模态内容很难精确估算，按上限保底加 1500 token
                    pieces.append(" " * 5000)

    # tools 定义也算入 input
    for tool in body.get("tools", []) or []:
        if not isinstance(tool, dict):
            continue
        pieces.append(str(tool.get("name", "")))
        pieces.append(str(tool.get("description", "")))
        try:
            pieces.append(json.dumps(tool.get("input_schema", {}), ensure_ascii=False))
        except Exception:
            pass

    text = "\n".join(pieces)
    if not text:
        return 1

    cjk_count = 0
    for ch in text:
        # 简单覆盖 CJK 统一表意 + 假名 + 韩文音节
        cp = ord(ch)
        if (
            0x4E00 <= cp <= 0x9FFF
            or 0x3040 <= cp <= 0x30FF
            or 0xAC00 <= cp <= 0xD7AF
            or 0x3400 <= cp <= 0x4DBF
        ):
            cjk_count += 1
    other_count = len(text) - cjk_count
    estimated = int(cjk_count * 1.5 + other_count / 3.5)
    return max(1, estimated)


@app.route('/v1/messages/count_tokens', methods=['POST'])
@app.route('/<prefix>/v1/messages/count_tokens', methods=['POST'])
def count_tokens(prefix=None):
    """Anthropic /v1/messages/count_tokens 接口的本地实现。

    无论 base_url 是否带前缀（例如 /anthropic），都能命中这条更具体的路由，
    优先级高于下面的 catch-all proxy。
    返回格式严格遵循 Anthropic 规范：{"input_tokens": <int>}。
    """
    raw = request.get_data()
    try:
        original_body = json.loads(raw) if raw else {}
    except Exception:
        original_body = {}

    estimated = _estimate_input_tokens(original_body)
    model = original_body.get("model", "unknown") if isinstance(original_body, dict) else "unknown"
    logger.info(
        f"count_tokens: prefix={prefix or '(none)'}, model={model}, "
        f"body_size={len(raw)}B, estimated_input_tokens={estimated}"
    )

    if DEBUG:
        logger.debug(
            f"[DEBUG] count_tokens 请求体:\n"
            f"{json.dumps(original_body, indent=2, ensure_ascii=False)}"
        )

    return Response(
        json.dumps({"input_tokens": estimated}),
        status=200,
        content_type='application/json',
        headers={'Cache-Control': 'no-cache'},
    )


@app.route('/', defaults={'path': ''}, methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
def proxy(path):
    """转发请求到 Vertex AI - 真正的流式透传 + 异步 Langfuse 记录"""
    # 透传 query string 到上游（如 ?beta=true 用于启用 Anthropic beta 特性）
    qs = request.query_string.decode("utf-8") if request.query_string else ""
    upstream_url = UPSTREAM_URL + (f"?{qs}" if qs else "")
    logger.info(f"请求路径: /{path}{('?' + qs) if qs else ''} -> {upstream_url}")

    body = request.get_data()
    try:
        original_body = json.loads(body) if body else {}
    except:
        original_body = {}

    if DEBUG:
        logger.debug(f"[DEBUG] 原始请求体:\n{json.dumps(original_body, indent=2, ensure_ascii=False)}")

    original_model = original_body.get("model", "claude-opus-4-6")  # vertex 代理默认模型

    # 创建 Langfuse generation（v4 API，在请求开始时）
    generation = _create_langfuse_generation(original_body, original_model)
    request_start_time = time.time()

    # 直接复制原始请求体
    vertex_body = original_body.copy()

    # 添加 Vertex AI 必需的字段
    vertex_body["anthropic_version"] = "vertex-2023-10-16"
    vertex_body["stream"] = True

    # 移除 Anthropic SDK 特有但 Vertex 不需要的字段
    vertex_body.pop("model", None)

    # 处理 system prompt (Vertex AI 需要字符串格式)
    if "system" in vertex_body and isinstance(vertex_body["system"], list):
        vertex_body["system"] = "".join(
            item.get("text", "") if isinstance(item, dict) else str(item)
            for item in vertex_body["system"]
        )

    # 设置默认 max_tokens（仅在客户端未指定时设置较大的默认值，避免截断）
    if "max_tokens" not in vertex_body:
        vertex_body["max_tokens"] = 128000

    logger.info(f"请求体大小: {len(json.dumps(vertex_body))} 字节")
    logger.info(f"包含字段: {list(vertex_body.keys())}")

    if DEBUG:
        logger.debug(f"[DEBUG] 转发请求体:\n{json.dumps(vertex_body, indent=2, ensure_ascii=False)}")

    # 基础 header（Vertex 必需）
    headers = {
        'api-key': API_KEY,
        'Content-Type': 'application/json',
    }
    # 透传客户端 anthropic-* / x-anthropic-* / x-stainless-* 等关键 header。
    # 特别是 anthropic-beta：缺失会导致 Vertex 不识别 thinking/context_management
    # 等 beta 字段，从而返回空响应或 error 事件，最终让 Claude Code 报
    # "Cannot read properties of undefined (reading 'input_tokens')"。
    _PASSTHROUGH_PREFIXES = ("anthropic-", "x-anthropic-", "x-stainless-")
    _PASSTHROUGH_SKIP = {
        "anthropic-version",      # 由 body.anthropic_version 控制
        "x-anthropic-api-key",
        "x-api-key",
    }
    # Vertex AI 上的 Anthropic 端点不识别的 anthropic-beta 标识，必须剥离。
    # 否则上游会以 invalid_request_error 直接拒绝整个请求（任意一个不识别的 beta
    # 都会导致整条请求失败，详见 Anthropic 官方 anthropic-beta header 处理逻辑）。
    # 出现新的不兼容 beta 时，往这里补即可，无需改其他逻辑。
    _VERTEX_UNSUPPORTED_BETAS = {
        "prompt-caching-scope-2026-01-05",
    }
    # 也允许按前缀匹配（处理同族多版本，如 prompt-caching-scope-* 全部不支持时）
    _VERTEX_UNSUPPORTED_BETA_PREFIXES = ()

    def _filter_anthropic_beta(raw_value: str) -> tuple[str, list, list]:
        """剥离 Vertex 不支持的 beta 标识，返回 (新值, 被剥离, 保留)。"""
        items = [b.strip() for b in raw_value.split(",") if b.strip()]
        kept, stripped = [], []
        for b in items:
            if b in _VERTEX_UNSUPPORTED_BETAS or any(
                b.startswith(p) for p in _VERTEX_UNSUPPORTED_BETA_PREFIXES
            ):
                stripped.append(b)
            else:
                kept.append(b)
        return ",".join(kept), stripped, kept

    forwarded_headers = []
    for h_name, h_val in request.headers.items():
        h_lower = h_name.lower()
        if h_lower in _PASSTHROUGH_SKIP:
            continue
        if not any(h_lower.startswith(p) for p in _PASSTHROUGH_PREFIXES):
            continue

        # anthropic-beta 特殊处理：剥离 Vertex 不支持的 beta 标识
        if h_lower == "anthropic-beta":
            new_val, stripped, kept = _filter_anthropic_beta(h_val)
            if stripped:
                logger.info(
                    f"[anthropic-beta] 剥离 Vertex 不支持的 beta: {stripped}, 保留: {kept}"
                )
            if not kept:
                # 全部被剥光：不发 anthropic-beta header
                continue
            h_val = new_val

        headers[h_name] = h_val
        # 截断长度从 80 提到 200，避免被截断后误判 header 内容
        forwarded_headers.append(f"{h_name}={h_val[:200]}")
    if forwarded_headers:
        logger.info(f"透传 header: {forwarded_headers}")
    
    # 使用共享状态收集 Langfuse 数据（在流式 generator 中填充）
    # 线程安全：generator 在主线程中顺序执行，不存在并发写入
    langfuse_state = {
        "output_texts": [],
        "tool_calls": [],
        "usage_info": {},
        "error_msg": None,
    }

    def generate():
        """真正的流式 generator：边收到上游数据边透传给客户端，同时收集 Langfuse 数据

        核心原则：透传逻辑和 Langfuse 收集逻辑完全隔离。
        即使 Langfuse 相关代码抛出任何异常，也绝不影响数据透传。
        """
        output_texts = langfuse_state["output_texts"]
        tool_calls = langfuse_state["tool_calls"]
        usage_info = langfuse_state["usage_info"]

        # 诊断用：记录上游 SSE 流的原始内容（最多 64 行 / 16KB），
        # 当 upstream 返回 200 但内容空 / 没有 usage / 含 error 事件时打出来定位真因。
        diag_raw_lines = []
        diag_total_bytes = 0
        diag_saw_message_start = False
        diag_saw_error_event = False

        try:
            with requests.post(upstream_url, headers=headers, json=vertex_body, stream=True, timeout=1000) as resp:
                if resp.status_code != 200:
                    error_text = resp.text[:500]
                    logger.error(f"上游错误 status_code={resp.status_code}, body={error_text}")
                    langfuse_state["error_msg"] = f"上游错误 {resp.status_code}: {error_text}"
                    yield f"event: error\ndata: {json.dumps({'error': resp.text})}\n\n"
                    return

                for line in resp.iter_lines():
                    if not line:
                        yield '\n'
                        continue

                    decoded = line.decode('utf-8')

                    # 诊断收集（最多前 64 行 / 16KB，超出截断）
                    diag_total_bytes += len(decoded)
                    if len(diag_raw_lines) < 64 and diag_total_bytes < 16 * 1024:
                        diag_raw_lines.append(decoded)
                    if 'message_start' in decoded:
                        diag_saw_message_start = True
                    if (
                        decoded.startswith('event: error')
                        or '"type":"error"' in decoded
                        or '"type": "error"' in decoded
                    ):
                        diag_saw_error_event = True
                        logger.warning(f"[upstream-error-event] {decoded[:500]}")

                    # ========== 第一步：先确定要透传的内容并立即 yield ==========
                    # 透传逻辑放在最前面，确保客户端尽快收到数据
                    line_to_yield = None
                    if decoded.startswith('data:') and 'message_start' in decoded:
                        # 修正 model 字段后透传
                        try:
                            data_json = json.loads(decoded[5:].strip())
                            if 'message' in data_json:
                                data_json['message']['model'] = original_model
                            line_to_yield = f"data: {json.dumps(data_json)}\n\n"
                        except Exception:
                            line_to_yield = decoded + '\n\n'
                    elif decoded.startswith('event:'):
                        line_to_yield = decoded + '\n'
                    elif decoded.startswith('data:'):
                        line_to_yield = decoded + '\n\n'
                    else:
                        line_to_yield = decoded + '\n'

                    # 立即透传给客户端
                    yield line_to_yield

                    # ========== 第二步：异步收集 Langfuse 数据（完全 try/except 隔离） ==========
                    try:
                        if decoded.startswith('data:'):
                            data_json = json.loads(decoded[5:].strip())
                            event_type = data_json.get("type", "")

                            # 收集文本输出
                            if event_type == "content_block_delta":
                                delta = data_json.get("delta", {})
                                delta_type = delta.get("type", "")
                                if delta_type == "text_delta":
                                    output_texts.append(delta.get("text", ""))
                                elif delta_type == "thinking_delta":
                                    output_texts.append(delta.get("thinking", ""))
                                elif delta_type == "input_json_delta":
                                    tool_calls.append(delta.get("partial_json", ""))

                            # 收集 content_block 开始信息
                            elif event_type == "content_block_start":
                                cb = data_json.get("content_block", {})
                                if cb.get("type") == "tool_use":
                                    tool_calls.append(f"\n[tool_use: {cb.get('name', 'unknown')}(id={cb.get('id', '')})] ")

                            # 收集 usage 信息
                            elif event_type == "message_delta":
                                u = data_json.get("usage", {})
                                if u:
                                    usage_info.update(u)
                            elif event_type == "message_start":
                                msg = data_json.get("message", {})
                                u = msg.get("usage", {})
                                if u:
                                    usage_info.update(u)
                    except Exception:
                        # Langfuse 数据收集失败不影响透传
                        pass

        except Exception as e:
            logger.error(f"请求失败: {e}")
            langfuse_state["error_msg"] = str(e)
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
        finally:
            # === 上游响应诊断 ===
            # 如果上游返回 200 但没拿到 usage / message_start / 出现 error 事件，
            # 把原始 SSE 内容 dump 到 warning 日志，方便定位 Vertex 真实拒绝原因。
            anomaly_reasons = []
            if not usage_info:
                anomaly_reasons.append("usage 为空")
            if not diag_saw_message_start:
                anomaly_reasons.append("未收到 message_start")
            if diag_saw_error_event:
                anomaly_reasons.append("含 error 事件")
            if anomaly_reasons:
                preview = "\n".join(diag_raw_lines) if diag_raw_lines else "(上游未返回任何 SSE 行)"
                logger.warning(
                    f"[upstream-anomaly] 上游响应异常 ({', '.join(anomaly_reasons)}), "
                    f"total_bytes={diag_total_bytes}, body_size={len(json.dumps(vertex_body))}, "
                    f"req_fields={list(vertex_body.keys())}\n"
                    f"---- upstream raw lines (first {len(diag_raw_lines)}) ----\n"
                    f"{preview}\n"
                    f"---- end ----"
                )

            # 流式传输结束后，异步提交 Langfuse 记录到后台线程池
            try:
                logger.info(
                    f"[Langfuse] 流结束，提交异步记录任务 "
                    f"(text片段={len(output_texts)}, tool片段={len(tool_calls)})"
                )
                _langfuse_executor.submit(
                    _async_finalize_langfuse,
                    generation,
                    list(output_texts),   # 传递副本，避免引用问题
                    list(tool_calls),
                    dict(usage_info),
                    langfuse_state["error_msg"],
                    request_start_time,
                )
            except Exception as e:
                logger.error(f"[Langfuse] 提交异步任务失败: {e}")

    return Response(
        stream_with_context(generate()),
        content_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Anthropic -> Vertex AI Claude 流式转发代理')
    parser.add_argument('--debug', action='store_true', help='开启 debug 模式，打印请求体和响应体')
    parser.add_argument('--port', type=int, default=LOCAL_PORT, help=f'监听端口 (默认: {LOCAL_PORT})')
    args = parser.parse_args()

    if args.debug:
        DEBUG = True

    if DEBUG:
        logging.getLogger().setLevel(logging.DEBUG)
        logger.info("Debug 模式已开启，将打印完整请求体和响应体")

    logger.info(f"代理启动: http://0.0.0.0:{args.port} -> {UPSTREAM_URL}")
    logger.info(f"Langfuse v4 监控: {'已启用' if langfuse_client else '已禁用'}")
    app.run(host='0.0.0.0', port=args.port, debug=True, threaded=True)
