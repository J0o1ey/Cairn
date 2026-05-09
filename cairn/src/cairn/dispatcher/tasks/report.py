"""Goal 达成后生成中文 Markdown 项目报告，并通过 server API 持久化。

这是一个**辅助任务**：它在 reason 任务的 `complete` 分支或 bootstrap 任务的
`complete` 分支后被调用，目的是把整个 graph 总结成可读的人类报告。

设计原则：
- **不阻塞 completion**：报告生成失败仅记录 warning，不会让 reason / bootstrap
  的 outcome 由 success 退化为 failed。项目本身的 completed 状态早已落库。
- **不抢占 worker lease**：调用时 reason 锁 / intent 锁已经释放（caller 会在
  调用本任务前先释放），这里只是一次普通的 LLM 调用。
- **独立 session**：使用 driver.build_execute(prepare_session()) 起一次新会话，
  不复用上游 reason / bootstrap 的会话，避免历史 context 污染报告生成。
"""
from __future__ import annotations

import logging
import time
from typing import Any

from cairn.dispatcher.config import DispatchConfig, WorkerConfig
from cairn.dispatcher.contracts import parse_json_output, validate_report_payload
from cairn.dispatcher.prompting import format_hints, load_prompt, render_prompt
from cairn.dispatcher.protocol.client import CairnClient
from cairn.dispatcher.runtime.cancellation import TaskCancellation
from cairn.dispatcher.runtime.containers import ContainerManager
from cairn.dispatcher.tasks.common import (
    did_timeout,
    preview,
    run_worker_process,
)
from cairn.dispatcher.workers.registry import get_driver
from cairn.server.models import ProjectDetail

LOG = logging.getLogger(__name__)


def generate_and_submit_report(
    config: DispatchConfig,
    client: CairnClient,
    container_manager: ContainerManager,
    project: ProjectDetail,
    export_yaml: str,
    worker: WorkerConfig,
    *,
    source: str,
) -> None:
    """生成并上报项目完成报告。任何异常都被吞掉、只记日志。

    `source` 用于日志和 server 端 `generator` 字段，便于追踪报告来自哪条
    完成路径（如 `reason.complete` 或 `bootstrap.complete`）。
    """
    project_id = project.project.id
    try:
        _run(config, client, container_manager, project, export_yaml, worker, source=source)
    except Exception:
        LOG.exception(
            "report generation crashed project=%s worker=%s source=%s",
            project_id,
            worker.name,
            source,
        )


def _run(
    config: DispatchConfig,
    client: CairnClient,
    container_manager: ContainerManager,
    project: ProjectDetail,
    export_yaml: str,
    worker: WorkerConfig,
    *,
    source: str,
) -> None:
    project_id = project.project.id
    driver = get_driver(worker.type)
    timeout = config.tasks.report.timeout
    started = time.perf_counter()

    container_name = container_manager.ensure_running(project_id)

    origin_text, goal_text = _origin_goal_text(project)
    hints_payload = [
        {
            "id": h.id,
            "creator": h.creator,
            "created_at": h.created_at,
            "content": h.content,
        }
        for h in project.hints
    ]

    prompt = render_prompt(
        load_prompt(config.runtime.prompt_group, "report.md"),
        {
            "project_title": project.project.title,
            "origin": origin_text,
            "goal": goal_text,
            "hints": format_hints(hints_payload) if hints_payload else "[]",
            "graph_yaml": export_yaml.strip(),
        },
    )

    session = driver.prepare_session()
    execute = driver.build_execute(worker, prompt, session)

    LOG.info(
        "starting report generation project=%s worker=%s source=%s timeout=%ss",
        project_id,
        worker.name,
        source,
        timeout,
    )
    cancellation = TaskCancellation()
    result = run_worker_process(
        container_manager,
        container_name,
        worker,
        execute.argv,
        phase="report",
        timeout_seconds=timeout,
        cancellation=cancellation,
    )
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    if did_timeout(result):
        LOG.warning(
            "report generation timed out project=%s worker=%s source=%s elapsed_ms=%s stdout_preview=%s stderr_preview=%s",
            project_id,
            worker.name,
            source,
            elapsed_ms,
            preview(result.stdout),
            preview(result.stderr),
        )
        return
    if result.returncode != 0:
        LOG.warning(
            "report generation command failed project=%s worker=%s source=%s code=%s elapsed_ms=%s stdout_preview=%s stderr_preview=%s",
            project_id,
            worker.name,
            source,
            result.returncode,
            elapsed_ms,
            preview(result.stdout),
            preview(result.stderr),
        )
        return

    try:
        model_output = driver.extract_response_text(result.stdout, result.stderr)
        payload: dict[str, Any] = parse_json_output(model_output)
        kind, markdown = validate_report_payload(payload)
    except Exception as exc:
        LOG.warning(
            "report parse failed project=%s worker=%s source=%s error=%s elapsed_ms=%s stdout_preview=%s",
            project_id,
            worker.name,
            source,
            exc,
            elapsed_ms,
            preview(result.stdout),
        )
        return

    if kind == "rejected":
        LOG.warning(
            "report rejected by model project=%s worker=%s source=%s elapsed_ms=%s",
            project_id,
            worker.name,
            source,
            elapsed_ms,
        )
        return

    assert markdown is not None
    generator = f"{worker.name}:{source}"
    response = client.submit_report(project_id, markdown, generator)
    if not response.ok:
        LOG.warning(
            "report submit failed project=%s worker=%s source=%s status=%s body=%s",
            project_id,
            worker.name,
            source,
            response.status_code,
            response.text,
        )
        return
    LOG.info(
        "report submitted project=%s worker=%s source=%s elapsed_ms=%s markdown_chars=%s",
        project_id,
        worker.name,
        source,
        elapsed_ms,
        len(markdown),
    )


def _origin_goal_text(project: ProjectDetail) -> tuple[str, str]:
    origin = ""
    goal = ""
    for fact in project.facts:
        if fact.id == "origin":
            origin = fact.description
        elif fact.id == "goal":
            goal = fact.description
    return origin, goal


def maybe_generate_completion_report(
    config: DispatchConfig,
    client: CairnClient,
    container_manager: ContainerManager,
    project_id: str,
    worker: WorkerConfig,
    *,
    source: str,
) -> None:
    """检查项目是否真的处于 completed 状态，是则生成并上报中文 Markdown 报告。

    所有异常都被吞掉、只记 warning，绝不影响调用方的 task outcome。
    供 reason / bootstrap 完成路径共用，避免代码重复。
    """
    try:
        fresh_project = client.get_project(project_id)
    except Exception:
        LOG.exception(
            "report skipped: failed to refresh project project=%s source=%s",
            project_id,
            source,
        )
        return
    if fresh_project.project.status != "completed":
        LOG.debug(
            "report skipped because project not completed project=%s status=%s source=%s",
            project_id,
            fresh_project.project.status,
            source,
        )
        return
    try:
        fresh_yaml = client.export_project(project_id)
    except Exception:
        LOG.exception(
            "report skipped: failed to export project yaml project=%s source=%s",
            project_id,
            source,
        )
        return
    generate_and_submit_report(
        config,
        client,
        container_manager,
        fresh_project,
        fresh_yaml,
        worker,
        source=source,
    )


__all__ = ["generate_and_submit_report", "maybe_generate_completion_report"]
