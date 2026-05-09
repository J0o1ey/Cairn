# Cairn 后端技术文档

> 这份文档面向后续接手 Cairn 后端的工程师 / Agent。它的目标不是「重复 README 里说过的话」，
> 而是把整个后端的**架构、控制流、协议契约、Prompt 设计、Context 工程**讲清楚，
> 并在最后列出**可执行的改进点清单**。读完之后你应能独立修改调度逻辑、prompt 模板、worker 适配器。

---

## 0. TL;DR

Cairn 是一个**面向有向状态空间搜索的通用问题求解引擎**。
它通过三种原语 —— [`Fact`](cairn/src/cairn/server/models.py:13-16)、[`Intent`](cairn/src/cairn/server/models.py:18-29)、[`Hint`](cairn/src/cairn/server/models.py:32-36) —— 在一张共享黑板（Blackboard）上从 `origin` 推导到 `goal`。

整个系统由两个进程组成：

1. **Cairn Server**（[`cairn/src/cairn/server/`](cairn/src/cairn/server)） — 一个 FastAPI + SQLite 的 **黑板服务**。
   它**只维护图的一致性**，本身不思考、不调度、不调用 LLM。所有写操作都带乐观并发控制（worker / heartbeat / claim）。

2. **Cairn Dispatcher**（[`cairn/src/cairn/dispatcher/`](cairn/src/cairn/dispatcher)） — 一个独立进程的 **唯一协议写入方**。
   它周期性轮询 Server，决定「下一步该跑什么」，把对应的 worker 容器拉起、把 prompt 喂给 LLM、
   把 LLM 的 JSON 输出**校验后**写回 Server。

LLM 永远只在 Dispatcher 这一侧出现，Server 完全无感知 LLM 的存在 —— 这是这套架构最重要的解耦。

```
                            HTTP (REST)
   ┌────────────┐   read/write   ┌────────────┐         ┌──────────────────┐
   │  Front-end │ ─────────────► │   Server   │ ◄────── │    Dispatcher    │
   │  (Vue 3)   │                │ (FastAPI)  │  poll   │ (single writer)  │
   └────────────┘                └────────────┘         └────────┬─────────┘
                                       │                         │
                                  SQLite WAL                docker exec
                                                                 │
                                                ┌────────────────▼────────────────┐
                                                │  Worker Container (per project) │
                                                │   claude / codex / pi / mock    │
                                                └─────────────────────────────────┘
```

---

## 1. 领域模型

> 出处：[`cairn/src/cairn/server/models.py`](cairn/src/cairn/server/models.py) + [`cairn/src/cairn/server/db.py`](cairn/src/cairn/server/db.py)

### 1.1 三种原语

| 原语 | 含义 | DB 表 | 关键字段 |
|---|---|---|---|
| **Fact** | 已确认的客观事实，可被复用 | [`facts`](cairn/src/cairn/server/db.py:31-36) | `(id, project_id)` 复合主键，`description` |
| **Intent** | 一个待探索方向，从一组 Fact 出发，「期望」推导出一条新 Fact | [`intents`](cairn/src/cairn/server/db.py:38-49) | `to_fact_id`（NULL 表示未结案）、`worker`、`last_heartbeat_at`、`concluded_at` |
| **Hint** | 人类随时注入的策略建议；agent 在下次读图时自然吸收 | [`hints`](cairn/src/cairn/server/db.py:59-66) | `content`、`creator`、`created_at` |

`Intent.from` 是多对多关系，独立存在于 [`intent_sources`](cairn/src/cairn/server/db.py:51-57)。
即「一条意图可以同时基于多个事实」。这是图能稳定收敛的关键 —— 因为后续 reason 阶段可以
让 LLM 把多条事实合并到一条新意图中，避免组合爆炸。

### 1.2 起点与终点

每个项目创建时由 [`create_project`](cairn/src/cairn/server/routers/projects.py:76-113) 强制注入两条特殊事实：

- `id="origin"` — 项目的起点描述（用户输入的"从何处出发"）
- `id="goal"` — 项目的目标事实（用户输入的"期望达成什么"）

**只有指向 `goal` 的 intent 被结案**才意味着项目完成。
[`complete_project`](cairn/src/cairn/server/routers/projects.py:249-292) 是唯一会创建 `to_fact_id='goal'` 的路径，
它把项目状态置为 `completed` 同时清空 `reason_*` 字段。

### 1.3 项目级状态机

```
            ┌──────► stopped ──────┐
created ──► active                  │
            └──────► completed ◄────┘
                       │
                       ▼ (reopen)
                     active
```

约束：
- `stopped` → `active` → `stopped` 可任意切换（[`update_project_status`](cairn/src/cairn/server/routers/projects.py:158-180)）。
- `completed` 不能直接切到 `stopped`/`active`，**只能走 [`reopen_project`](cairn/src/cairn/server/routers/projects.py:295-350)** —— 它会删掉那条
  指向 `goal` 的 completion intent，新建一条 `f0xx` 事实记录"为何不算完成"，再造一条 `external_feedback`
  intent 作为外部反馈节点把项目接回 `active`。这套设计让 reopen 留下完整可审计的痕迹。
- `stopped` 时所有未结案的 intents 的 `worker` 都被清空（让原 worker 释放占用）；
  `completed` 时 `reason_*` 字段被清空。

### 1.4 ID 生成

- 项目 ID 用全局递增计数器 `proj_001` / `proj_002` …（[`next_project_id`](cairn/src/cairn/server/services.py:14-17)）。
- Fact / Intent / Hint 用**项目内**的递增计数器（[`scoped_counters`](cairn/src/cairn/server/db.py:75-80) + [`_next_scoped_id`](cairn/src/cairn/server/services.py:20-36)），
  得到 `f001` / `i001` / `h001`。这样图谱在 YAML 导出时人眼可读、跨项目无冲突。

---

## 2. Server 端架构

### 2.1 路由划分

[`app.py`](cairn/src/cairn/server/app.py) 注册了 5 个 router：

| Router | 主要职责 | 关键端点 |
|---|---|---|
| [`settings.py`](cairn/src/cairn/server/routers/settings.py) | 全局心跳/推理超时配置 | `GET/PUT /settings` |
| [`projects.py`](cairn/src/cairn/server/routers/projects.py) | 项目 CRUD + 状态切换 + reason 协议 + 完成 + 重新打开 | `/projects`, `/projects/{id}/status`, `/projects/{id}/reason/*`, `/projects/{id}/complete`, `/projects/{id}/reopen` |
| [`hints.py`](cairn/src/cairn/server/routers/hints.py) | 写入 hint | `POST /projects/{id}/hints` |
| [`intents.py`](cairn/src/cairn/server/routers/intents.py) | 创建 / 心跳 / 释放 / 结案意图 | `POST /projects/{id}/intents`, `/intents/{iid}/heartbeat`, `/intents/{iid}/release`, `/intents/{iid}/conclude` |
| [`export.py`](cairn/src/cairn/server/routers/export.py) | 导出 YAML / Timeline / 中文 Markdown 报告 | `GET /projects/{id}/export?format=yaml|timeline|report_zh` |

### 2.2 并发控制：claim / heartbeat / lease

Server 是真正的并发屏障。三件事必须看清：

#### (a) Intent 的 worker 锁

每条 intent 有 `worker` + `last_heartbeat_at` 两个字段。

- **认领**：调用 [`/projects/{id}/intents/{iid}/heartbeat`](cairn/src/cairn/server/routers/intents.py:74-93)。如果该 intent
  当前 `worker IS NULL` 或 `worker = body.worker`，就可以更新 `worker` + `last_heartbeat_at = now`，
  否则返回 409。
- **续约**：每 `interval` 秒调一次同一个 heartbeat 端点，刷新 `last_heartbeat_at`。
- **释放**：[`/release`](cairn/src/cairn/server/routers/intents.py:96-115) 把 `worker` 置 NULL（仅当持有者匹配）。
- **过期回收**：每个读端点会先调 [`expire_workers`](cairn/src/cairn/server/services.py:221-236)，
  把所有"心跳超过 `intent_timeout` 秒"的 intent 自动 `worker = NULL`，让其他 dispatcher 实例可以接手。

这套设计让 dispatcher 进程可以**安全地跨节点部署**：worker 进程崩溃 / dispatcher 重启都不会让 intent
永久卡死，最坏也只是被延迟 `intent_timeout` 秒后自动回收。

#### (b) Project 级 reason 锁

Reason 是"读全图、决定下一步"的整体性步骤，**全项目同一时刻只能有一个 reason 在跑**。
锁存在 `projects` 表自己的 4 列：`reason_worker`、`reason_trigger`、`reason_started_at`、
`reason_last_heartbeat_at`。
- 三个端点 [`reason/claim`](cairn/src/cairn/server/routers/projects.py:183-208) / [`/heartbeat`](cairn/src/cairn/server/routers/projects.py:211-229) / [`/release`](cairn/src/cairn/server/routers/projects.py:232-246) 形成同样的 lease 协议。
- 同样有 [`expire_reason_leases`](cairn/src/cairn/server/services.py:239-256) 自动回收超时持有人。

#### (c) Goal 不可作为 from

[`validate_goal_not_in_sources`](cairn/src/cairn/server/services.py:90-92) 在所有 intent 创建路径强制：`goal` 永远不能作为
`from` 元素。这保证图严格保持「从 origin 走向 goal」，不会出现循环。

### 2.3 数据库实现细节

- [`db.py`](cairn/src/cairn/server/db.py) 用 SQLite + WAL + `PRAGMA foreign_keys=ON`，所有连接通过
  [`get_conn()`](cairn/src/cairn/server/db.py:94-107) 的 contextmanager 管理 commit / rollback。
- 没有 ORM。所有写都是手写 SQL，路由里直接 `conn.execute(...)`。这是工程上的取舍 —— 模型只有 4
  张表，schema 几乎不变，加 ORM 反而增加心智负担。
- 时间戳统一存 `YYYY-MM-DDTHH:MM:SSZ`，超时计算用 `julianday()` 差。
- ID 计数器（全局 `counters` + 项目内 `scoped_counters`）也是 SQLite 表，一切原子。

---

## 3. Dispatcher 架构

> 出处：[`cairn/src/cairn/dispatcher/scheduler/loop.py`](cairn/src/cairn/dispatcher/scheduler/loop.py) +
> [`cairn/src/cairn/dispatcher/tasks/`](cairn/src/cairn/dispatcher/tasks)

### 3.1 调度主循环

[`DispatcherLoop.run()`](cairn/src/cairn/dispatcher/scheduler/loop.py:71-101) 每 `interval` 秒做一遍：

```
1. _reap_futures()            # 回收已完成的 worker 任务、收集结果、记录 unhealthy / rejected
2. _reap_cleanup_futures()    # 回收容器清理任务
3. summaries = list_projects()
4. _initialize_reason_checkpoints(summaries)  # 给新见到的项目记录初始 fact/hint/intent 数
5. _refresh_runtime_projects(summaries)       # 更新 dispatcher 关心的"在跑项目"集合
6. _cancel_inactive_tasks(summaries)          # 项目变 stopped/completed 立刻取消运行中的 task
7. _queue_container_cleanups(summaries)       # 完成/暂停的项目去清理 docker 容器
8. _dispatch_available(summaries)             # 真正的调度：看哪些 active 项目能开新任务
```

### 3.2 单项目调度决策树（核心）

[`_try_dispatch_project`](cairn/src/cairn/dispatcher/scheduler/loop.py:178-258) 是整个系统的认知中枢，它对每个 `active` 项目的决策顺序是：

```
不能调度的快速跳过
│
├─ 容器还在清理 ⇒ skip
├─ 该项目并发已满（max_project_workers）⇒ skip
├─ 项目状态不是 active ⇒ skip
│
└─ 该项目处于 "初始项目"（仅 origin/goal 两条 fact，且没有任何业务 intent）
   │
   ├─ 是 ⇒ 走 BOOTSTRAP 分支
   │       1. 复用或创建 bootstrap intent（from=['origin']，creator='dispatcher.bootstrap'）
   │       2. 该 intent 已被本地认领 / 远程认领 ⇒ skip
   │       3. 找 worker → claim → 提交 run_bootstrap_task
   │
   └─ 否 ⇒
       │
       ├─ 有"未认领且非本地正在跑的非 bootstrap intent" ⇒ EXPLORE 最新一条
       │       挑 created_at 最大的 intent → claim → 提交 run_explore_task
       │
       └─ 没有可探索的意图：
              ├─ reason 已有 worker 在跑 ⇒ skip
              └─ 否则计算 reason_trigger（图相对上次 reason 时是否变了）
                     ├─ 变了 ⇒ REASON
                     └─ 没变 ⇒ skip（避免反复推理同一张图）
```

**关键洞察**：dispatcher 永远不主动结案、不发明 fact。它只做"决定调度什么"，
真正的事实生成发生在 worker 进程跑完后写回 Server 的瞬间。

### 3.3 Reason 触发器

[`_reason_trigger`](cairn/src/cairn/dispatcher/scheduler/loop.py:617-631) 是控制 reason 频率的核心，三种条件之一才触发：

- 项目第一次见到（`initial`）
- `len(facts)` 比上次 reason 时增加
- `len(hints)` 比上次 reason 时增加
- 上次 reason 还有 open intent，本次变成 0（探索全部消化完）

如果以上都没变，就不触发 reason —— **避免在静态图上反复浪费 LLM 调用**。
[`reason_checkpoints`](cairn/src/cairn/dispatcher/models.py) 维护这些"上次 reason 时的快照"。

### 3.4 Worker 选型

[`_select_worker`](cairn/src/cairn/dispatcher/scheduler/loop.py:467-527) → [`choose_worker`](cairn/src/cairn/dispatcher/scheduler/worker_select.py:8-17) 的排序键是：

```
(worker.priority,                    # 用户配置的优先级，小的优先
 running_counts.get(worker.name, 0), # 同优先级时挑当前最闲的
 random.random())                    # 完全等价时打散
```

被排除的 worker 会进入四种 blocked 桶：`busy / unhealthy / rejected / task_type`，
分别对应「并发满 / 健康检查失败 / 上次输出被语义拒绝 / 不支持该 task_type」。
被标记 unhealthy / rejected 的 worker 都有 5 秒退避（[`UNHEALTHY_RETRY_AFTER_SECONDS`](cairn/src/cairn/dispatcher/scheduler/loop.py:24) 等）。

### 3.5 容器与心跳

每个项目对应一个 docker 容器 `cairn-dispatch-{project_id}`：

- [`ContainerManager.ensure_running`](cairn/src/cairn/dispatcher/runtime/containers.py:34-71) 复用已有容器，否则用配置里的镜像
  起一个 `sleep infinity` 的长生命周期容器。
- 真正的命令通过 `docker exec` 进入容器跑（claude/codex/pi 各自的 CLI）。
- [`HeartbeatLease`](cairn/src/cairn/dispatcher/runtime/heartbeat.py:23-122) 是一个独立线程：每 `interval` 秒
  调一次心跳；连续失败超过 `interval × 2` 秒（grace 期）后把附着的进程 `kill()`，
  让外层立刻感知并 abort，然后释放 intent。
- 如果心跳遇到 403/409（项目变 stopped/completed），立即 fail-fast，不再等待。

### 3.6 Conclude Fallback（最重要的容错机制）

参见 [`_try_conclude_fallback`](cairn/src/cairn/dispatcher/tasks/explore.py:243-381) 与 [`_try_conclude_fallback`](cairn/src/cairn/dispatcher/tasks/bootstrap.py)。

主流程（explore / bootstrap 的 execute 阶段）发生 **超时 或 解析失败** 时：

1. 不直接 fail，而是用同一个 session（[`SeedSessionDriver.prepare_session`](cairn/src/cairn/dispatcher/workers/base.py:52-54) 给 claude
   预留 UUID，[`RegexSessionDriver`](cairn/src/cairn/dispatcher/workers/base.py:57-65) 给 codex 从 stderr 抓 session id）
2. 调用 [`/explore_conclude.md`](cairn/src/cairn/dispatcher/prompts/default/explore_conclude.md) 或 [`/bootstrap_conclude.md`](cairn/src/cairn/dispatcher/prompts/default/bootstrap_conclude.md) 让模型**把已经确认的发现总结成 JSON**。
3. 只有这次 conclude 调用也失败，才真正 fail。

这一步是 Cairn **能在 LLM 不稳定输出格式时仍然产出 fact** 的关键机制。

---

## 4. Prompts 剖析

`cairn/src/cairn/dispatcher/prompts/default/` 共 5 个模板：

| 文件 | 触发时机 | 输出 schema | 为什么这样设计 |
|---|---|---|---|
| [`bootstrap.md`](cairn/src/cairn/dispatcher/prompts/default/bootstrap.md) | 项目刚创建、图里只有 origin/goal | `{accepted, data:{fact:{description}, complete?:{description}}}` | 给一次"直接尝试解决"的机会，能一击制胜就直接完成 |
| [`bootstrap_conclude.md`](cairn/src/cairn/dispatcher/prompts/default/bootstrap_conclude.md) | bootstrap 超时/解析失败的 fallback | `{accepted, data:{fact:{description}}}` | 强制立刻停手并把"已经确认的最有价值事实"产出 |
| [`reason.md`](cairn/src/cairn/dispatcher/prompts/default/reason.md) | 图发生变化时（fact/hint 增加 或 open_intents 清零） | `{accepted, data:{complete?:{from,description}, intents?:[{from,description}]}}` | 决策：完成？提新意图？还是 noop？ |
| [`explore.md`](cairn/src/cairn/dispatcher/prompts/default/explore.md) | 有未认领 intent 时，挑最新一条认领并执行 | `{accepted, data:{description}}` | 沿单一意图深入，输出一条新 fact |
| [`explore_conclude.md`](cairn/src/cairn/dispatcher/prompts/default/explore_conclude.md) | explore 超时/解析失败的 fallback | 同上 | 强制立刻停手并总结已有结论 |

### 4.1 共同输出契约

所有 5 个 prompt 强制：

```
返回唯一一个原始 JSON 对象，禁止任何额外文本。
{"accepted": true, "data": {...}}      正常返回
{"accepted": false, "reason": "..."}   拒绝（被解析为 outcome="rejected"）
```

[`output_parser.py`](cairn/src/cairn/dispatcher/output_parser.py) 的 [`extract_json_object`](cairn/src/cairn/dispatcher/output_parser.py:11-37) 支持三种解析路径：
1. 整段文本 `json.loads` 成功
2. 三反引号 fenced block（``` 或 ```json``` ）抽出来再 loads
3. 从任意 `{` 开始 `raw_decode`，扫到第一个完整对象

[`contracts.py`](cairn/src/cairn/dispatcher/contracts.py) 的 `validate_*_payload` 系列再做语义校验，
并且兼容**未带 `accepted` 包装**的扁平 payload（提高 LLM 容错）。

### 4.2 Reason 的关键约束

[`reason.md`](cairn/src/cairn/dispatcher/prompts/default/reason.md) 有几条非常重要的"减熵"规则，建议任何调优都先保留：

- `data.complete.from` 必须出自 `{fact_ids}` 列表（实际就是除 `goal` 之外的所有 fact id）。这是
  服务端 [`validate_facts_exist`](cairn/src/cairn/server/services.py:79-87) 会再次校验的硬约束。
- `如果 Open Intents 非空且没有更值得探索的方向，可以返回 noop`。这个"允许 noop"是图收敛
  的关键——避免 reason 因为情绪上"必须做点什么"而无限制造噪声 intent。
- `每次最多提 {max_intents} 个非重叠、可并行的高价值方向`。max_intents 在
  [`dispatch.yaml`](dispatch.yaml:33) 里默认 2。这是控制图爆炸最直接的旋钮。

### 4.3 两条横切全局的硬规则

最近两次 prompt 升级各自加了一条**横切所有 5 个 default prompt** 的硬约束。
它们写在每个 Rules 段的最前面（reason 多一条同样规则的变体），是 worker 行为的不可撤销契约。

#### (a) Evidence is mandatory

> description 中每一条关键 finding 必须附带：
> - 完整的 raw HTTP 请求（method、URL、headers、body），或
> - 完整的工具命令行（含全部 flag/参数/工作目录/关键环境变量与决定性输出）。
> - 用 fenced code block 关联 finding 与证据；超长内容须落盘并给出获取命令。
> - conclude 阶段对无证据的旧结论必须降级为"unverified"或丢弃，禁止伪造证据。

大幅提升 Cairn 输出的可审计性，特别适合渗透 / CTF / 安全研究等需要复现的场景。

#### (b) Language — 强制中文输出

> 所有自然语言 description 字段（`fact.description`、`intent.description`、
> `complete.description`、`intents[].description` 等）必须使用 **简体中文 (zh-CN)**。
>
> 以下内容**严禁翻译**，必须保持原样：
> - JSON key、协议字段名（`accepted` / `data` / `from` / `description` 等）
> - fact / intent / hint 标识符（`f001` / `i002` / `h003` / `origin` / `goal`）
> - URL、文件路径、shell / CLI 命令、raw HTTP 请求和 headers、代码片段
> - 环境变量名、base64 / hex / token 字面量、错误码、文件名/二进制名
> - fenced code block 内的证据（HTTP / 命令行 / 响应片段）必须与实际观察一致，不可本地化
>
> Origin / Goal / Hints 即使是英文，也只在叙述中翻译解读，不要改写其原文引用。

设计理由：让前端 UI、中文报告、时间线日志在视觉上自然中文化，**同时不破坏 dispatcher
↔ server 的 JSON schema 与 fact id 的可机器解析性**。schema 一字未动。

### 4.4 Mock prompts

[`prompts/mock/`](cairn/src/cairn/dispatcher/prompts/mock) 是测试用的极简 JSON 桩，配合 [`MockDriver`](cairn/src/cairn/dispatcher/workers/adapters/mock.py)
按 [`MOCK_DEFAULT_BEHAVIOR`](cairn/src/cairn/dispatcher/config.py:64-122) 定义的概率分布生成不同 outcome（complete / fact /
rejected / invalid_json / invalid_payload / command_fail），用于**验证调度链路**而不是真实 LLM 行为。

---

## 5. 完整数据流：从一次调用到一条新 Fact

以 **explore** 为例，把所有抽象拼起来：

```
[Dispatcher Loop]
  └─ list_projects                                    ← Server: SQLite
  └─ _try_dispatch_project(project)
      └─ 找到 unclaimed intent i007
      └─ _select_worker → claudecode_x
      └─ POST /projects/p001/intents/i007/heartbeat   ← 抢占 worker 锁
      └─ executor.submit(run_explore_task, ...)

[run_explore_task @ ThreadPool]
  └─ HeartbeatLease.start                             ← 后台线程每 3s 发一次心跳
  └─ ContainerManager.ensure_running                  ← docker run -d --name cairn-dispatch-p001 ...
  └─ run_healthcheck(driver.build_healthcheck)        ← 容器内 curl LLM endpoint
  │
  └─ render_prompt(explore.md, {graph_yaml, intent_id, intent_description})
  │
  └─ run_worker_process(driver.build_execute(...))    ← docker exec ... claude --session-id ... -p -- "$prompt"
  │
  └─ ManagedProcess 在子线程中实时被心跳监测到失败时 kill()
  │
  └─ 进程退出后：
       try:
           model_output = driver.extract_response_text(stdout)
           payload      = parse_json_output(model_output)            ← 容错 JSON 抽取
           kind, desc   = validate_explore_payload(payload)          ← 语义校验
       except parse error:
           if not driver.supports_conclude(): return "failed"
           if not project_allows_conclude_fallback(): return "failed"
           # 用同一个 session id 调 explore_conclude 让模型重整理
           result = run_worker_process(driver.build_conclude(...))
           ...

  └─ POST /projects/p001/intents/i007/conclude        ← 写回 fact，原子地 set to_fact_id, concluded_at
  │      ↑ Server 在这里 next_fact_id() 分配 f00x，并把它接到 i007 的 to_fact_id 上
  │
  └─ HeartbeatLease.stop / best_effort_release
```

**两次调度后**：
- 下一轮主循环看到 `len(facts)` 增加 → [`_reason_trigger`](cairn/src/cairn/dispatcher/scheduler/loop.py:617-631) 返回 `"facts:N->N+1"`
- 触发 reason → LLM 看到新图 → 决定下一批 intent 或宣告 complete

这个**「explore → fact → reason → 新 intent → explore …」的反馈环**就是 Cairn 的整个心跳。

---

## 6. Prompt 调优手册

### 6.1 旋钮全景

| 旋钮 | 位置 | 作用 | 调小 / 调大的副作用 |
|---|---|---|---|
| `tasks.reason.max_intents` | [`dispatch.yaml`](dispatch.yaml:33) | reason 单次最多产出几个新 intent | 太大 → 图爆炸、worker 排队；太小 → 单步推不出多分支假设 |
| `tasks.bootstrap.timeout` | [`dispatch.yaml`](dispatch.yaml:26) | 第一次"直接试一把"的预算 | 太小 → 简单题也只能走 reason 链；太大 → 难题白白卡住主循环 |
| `tasks.explore.timeout` | [`dispatch.yaml`](dispatch.yaml:36) | 单条 intent 探索预算 | 影响吞吐与成果丰满度 |
| `tasks.*.conclude_timeout` | 同上 | conclude fallback 预算 | 太小 → 总结来不及；太大 → 浪费已被卡死的资源 |
| `runtime.interval` | [`dispatch.yaml`](dispatch.yaml:11) | 调度 tick 周期 | 影响 reason 触发延迟 与 心跳精度 |
| `runtime.max_workers` / `max_running_projects` / `max_project_workers` | 同上 | 三层并发上限 | 直接关联吞吐与单项目深度 |
| `intent_timeout` / `reason_timeout` | Server `settings` 表 | 心跳过期阈值 | 必须 > `runtime.interval × 2`，[`_validate_server_settings`](cairn/src/cairn/dispatcher/scheduler/loop.py:811-834) 启动会校验 |
| Worker `priority` | [`dispatch.yaml`](dispatch.yaml:55-63) `workers[].priority` | 同任务时的优选 | 配合多模型时给"主力 + 兜底"分层 |

### 6.2 调 prompt 的工程方法

1. **永远先改 mock，再改 default**。Mock prompt 极简，能快速验证调度路径不被破坏。
2. **每次只改一个 Rule**。先在 explore / reason 各跑 5～10 个对比项目（同一 origin/goal），
   记下 fact 数量、reason 调用次数、首次 complete 时间。
3. **用 [`/projects/{id}/export?format=timeline`](cairn/src/cairn/server/routers/export.py) 看每条 fact / intent 的产生顺序与 actor**，
   它已经按时间排好序，是观察"路径漂移"最直观的工具。
4. **看 `unclaimed_intent_count` 在项目结束时的残留**。如果远高于 `len(intents)` 的一半，说明
   reason 在拼命提意图但 explore 跟不上 → 调小 `max_intents` 或加 worker。
5. **尝试中文报告**（`format=report_zh`，[`_export_report_zh`](cairn/src/cairn/server/routers/export.py)），它会按 6 段式输出
   完整路径，复盘 prompt 行为最快。

### 6.3 现有 prompt 的潜在改进点

| 现有问题 | 表现 | 推荐改动 |
|---|---|---|
| reason 看不到"上次 reason 之后图发生了什么变化" | 模型每次都要重读全图，重复推理 | 在 prompt 里塞一段 `delta_yaml`：上次 reason 后新增的 facts/hints 摘要 |
| explore 没有"已尝试过且失败的方向"输入 | 容易反复提相似 intent | 给每条 intent 维护"sibling intent 列表"，让 explore 知道哪些方向同辈在走 |
| bootstrap 与 explore 输出 schema 不同 | LLM 在两种任务间易混淆 | 把 bootstrap 拆成"先尝试 explore 再决定 complete"两步，统一输出格式 |
| 没有跨项目知识沉淀 | 每个项目都从零开始 | 增加 `lessons_learned` 通道：从历史 completed 项目中萃取片段注入 reason prompt |
| Hints 只是字符串列表 | 难以表达"该 hint 适用于某条 fact 路径" | 给 hint 加可选 `applies_to: [fact_ids]` 字段并在 reason 里高亮 |

---

## 7. Context Engineering 改进点（按 ROI 排序）

### P0 — 强 ROI、小改动

1. **Reason 增量上下文**（最值钱）
   - 现状：reason 每次都收到完整 `graph_yaml`。项目大了 token 爆炸。
   - 改动：把图序列化拆成两段 —— `graph_summary`（origin/goal/已结案 fact 数）+ `recent_changes`（自上次 reason 起的增量）。
   - 落点：在 [`tasks/reason.py`](cairn/src/cairn/dispatcher/tasks/reason.py) 里基于
     [`reason_checkpoints`](cairn/src/cairn/dispatcher/scheduler/loop.py:49) 计算 delta，扩展 [`prompting.py`](cairn/src/cairn/dispatcher/prompting.py) 的
     formatters。**注意要同步改 [`prompts/default/reason.md`](cairn/src/cairn/dispatcher/prompts/default/reason.md) 的 placeholder**
     和 [`config.py`](cairn/src/cairn/dispatcher/config.py:37-43) 里的 `DEFAULT_PROMPT_REQUIRED_TOKENS`。

2. **Fact 描述压缩 + 文件外置**
   - 现状：fact `description` 没有长度上限。一旦 LLM 把命令输出/文件全 dump 进来就会污染所有
     后续 reason 的 context。
   - 改动：在 explore 写回前做长度判断；超过阈值则强制走"落盘 + 摘要 + 引用"三段式。可以在
     [`write_conclude_result`](cairn/src/cairn/dispatcher/tasks/common.py) 里加预处理。
   - 配合 prompt 的"长内容应放进文件再引用"规则就能闭环。

3. **Token 预算可观测**
   - 加 metrics：每个 prompt 的 input/output token、每次 task 的 wall time。
   - 现成钩子在 [`logging.py`](cairn/src/cairn/dispatcher/logging.py)，可挂到每个 `run_worker_process` 收集 driver 的实际消耗。
   - 没有度量就没有调优 —— 这一步先做。

### P1 — 结构性改进

4. **Open intents 多维度排序**
   - 现状：[`_dispatch_explore`](cairn/src/cairn/dispatcher/scheduler/loop.py:408-465) 永远挑 `created_at` 最大的。
   - 改动：引入 intent 优先级（基于 fact 距 goal 的图距离 / 同源簇大小 / hint 命中），让 explore
     先消化"最有可能逼近 goal"的方向。这需要 reason 在产出 intent 时一并产出 `priority`/`tags`。

5. **Reason / Explore 输出范式收敛**
   - 现在 4 个非 reason prompt 输出形如 `{accepted,data:{...}}`，reason 产 `{accepted,data:{intents | complete | noop}}`。
     LLM 在不同 prompt 间易混淆 schema。
   - 改动：统一所有 prompt 输出为 `{accepted, decisions:[{type:"add_fact|add_intent|complete", ...}]}`，
     在 [`contracts.py`](cairn/src/cairn/dispatcher/contracts.py) 一次性校验。

6. **Prompt 模板版本化**
   - 现在 prompt 改了直接覆盖，没有 git 之外的痕迹。建议在文件头部加 `<!-- version: yyyy-mm-dd-N -->`
     并在 reason 写回时把版本号一起带回，方便后续做 A/B。

7. **Reason / Explore 上下文持久化**
   - 把每次 LLM 调用的 prompt + raw response 落盘到 `findings/{project_id}/{task_id}.json`，
     用于 prompt 调优时回放。Server 已有 SQLite 但**没有对接 task 维度日志**。

### P2 — 体系级改进

8. **多 worker 投票 / 集成**
   - 现状：每条 intent 只交给一个 worker。复杂题特别需要"多模型互验"。
   - 改动：让 reason 输出可选的 `redundancy: 2`，让同一条 intent 同时被两个不同 worker 跑，
     在 conclude 阶段用第三个 worker 做合并（或简单 majority）。

9. **Hints → 自动 prompt slot**
   - 现状：hints 仅在 reason / bootstrap 用。explore 里也应该接收"与当前 intent 相关的 hints"。
   - 改动：用 LLM 做一次离线匹配，把每条 hint 标注 `relevant_intents:[ids]`，在 explore prompt
     里只塞相关 hint，避免无关 hint 的污染。

10. **图压缩与显著性**
    - 现状：`graph_yaml` 是平铺的 fact + intent 列表，缺少"主路径"概念。
    - 改动：在导出时计算从 origin 到当前最深 fact 的最短链，作为 `critical_path`
      段单独前置，让 LLM 一眼看清主线。这是认知负担最大的优化方向。

11. **回放与 What-If**
    - 前端已经有完整的 replay；后端可以追加 "what-if" 端点：基于某一时点的图快照，
      让 LLM 重新 reason，对比真实历史决策。这能反向训练我们的 reason prompt。

---

## 8. 容易踩的坑

写 / 改后端时务必记住：

1. **Server 永远是单写者的真相源**。任何"在 dispatcher 内存里维护状态再延迟同步到 Server"的尝试
   都会引发心跳竞态。除了 [`reason_checkpoints`](cairn/src/cairn/dispatcher/scheduler/loop.py:49) 这种纯本地优化以外，所有状态都必须落 Server。
2. **Goal 不可作为 from**。[`validate_goal_not_in_sources`](cairn/src/cairn/server/services.py:90-92) 是硬约束，前端 / dispatcher 都
   不能绕开。误以为 goal 可以"被合并"会导致 400。
3. **Reason 锁是项目级而不是全局**。两个项目可以同时 reason，但同一项目同一时间只能一个。
4. **Worker 释放是 best-effort**。[`best_effort_release`](cairn/src/cairn/dispatcher/tasks/common.py) 在 409 时会安静吞掉，
   依赖服务端的 `expire_workers` 兜底——这是设计，不是 bug。
5. **bootstrap intent 是 dispatcher 自己创造的**（creator=`dispatcher.bootstrap`，
   description=`bootstrap`）。前端识别 bootstrap 节点就靠这一组组合标记。
   **修改这两个常量会让 UI 失效**。
6. **`_export_report_zh` 的 6 段式 markdown 是对外稳定契约**（前端「中文报告」Tab + 项目卡片
   按钮直接消费）。改字段名要同步改前端。
7. **prompt 修改后必须跑 [`validate_prompt_resources`](cairn/src/cairn/dispatcher/config.py:269-282)**，
   否则启动时会 RuntimeError。它强制每个 prompt 必须含特定的 `{placeholders}`。
8. **新增 worker 类型必须**：在 [`WORKER_ENV_KEYS`](cairn/src/cairn/dispatcher/config.py:17-35) 注册环境变量、
   在 [`workers/adapters/`](cairn/src/cairn/dispatcher/workers/adapters) 写适配器、
   在 [`workers/registry.py`](cairn/src/cairn/dispatcher/workers/registry.py) 注册 driver。

---

## 9. 入门索引（按"我想做什么"组织）

| 我想… | 看这里 |
|---|---|
| 改一条 reason 的规则 | [`prompts/default/reason.md`](cairn/src/cairn/dispatcher/prompts/default/reason.md) → [`tasks/reason.py`](cairn/src/cairn/dispatcher/tasks/reason.py) → [`contracts.py:validate_reason_payload`](cairn/src/cairn/dispatcher/contracts.py:62-101) |
| 增加一种新 LLM worker | [`workers/base.py`](cairn/src/cairn/dispatcher/workers/base.py) + [`workers/adapters/`](cairn/src/cairn/dispatcher/workers/adapters) + [`workers/registry.py`](cairn/src/cairn/dispatcher/workers/registry.py) + [`config.py:WORKER_ENV_KEYS`](cairn/src/cairn/dispatcher/config.py:17-35) |
| 改并发上限 / 心跳 / 调度间隔 | [`dispatch.yaml`](dispatch.yaml) `runtime.*` |
| 加一个新 API 端点 | 在 [`server/routers/`](cairn/src/cairn/server/routers) 新增文件，[`server/app.py`](cairn/src/cairn/server/app.py) 注册 |
| 改图导出格式 | [`server/routers/export.py`](cairn/src/cairn/server/routers/export.py) |
| 调试一次具体的失败 | 看 dispatcher stdout 里的 `task=... worker=... outcome=...` 行 + `stdout_preview` / `stderr_preview` |
| 跑端到端冒烟测试 | 用 `prompt_group: mock` + `worker.type: mock`，配合 `MOCK_*_OUTCOMES` 控制概率分布 |
| 不依赖 docker 联调 | 单跑 `uv run --project cairn cairn serve` 后用 [`cairn-web/`](cairn-web) 的前端联调 |

---

> 维护建议：本文件随**架构性变更**同步更新（新增 router、新增 task type、新增 worker driver、
> prompt schema 改动、并发协议改动）。Bug fix / 微观重命名不必动这里。
> 上次更新：与最近一次"前端 NeoNexus 改名 + 中文报告 + 证据规则" 同步。
