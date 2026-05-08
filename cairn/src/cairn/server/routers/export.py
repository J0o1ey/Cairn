from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from datetime import datetime
import yaml

from cairn.server.db import get_conn
from cairn.server.services import expire_reason_leases, expire_workers, get_project_or_404

router = APIRouter(tags=["export"])


def format_export_timestamp(value: str | None) -> str | None:
    if not value:
        return value
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S")


def _load_project_data(conn, project_id: str):
    expire_workers(conn, project_id)
    expire_reason_leases(conn, project_id)
    proj = get_project_or_404(conn, project_id)

    facts = conn.execute(
        "SELECT id, description FROM facts WHERE project_id = ?", (project_id,)
    ).fetchall()
    hints = conn.execute(
        "SELECT content, creator, created_at FROM hints WHERE project_id = ? ORDER BY created_at",
        (project_id,),
    ).fetchall()
    intents = conn.execute(
        "SELECT * FROM intents WHERE project_id = ? ORDER BY created_at",
        (project_id,),
    ).fetchall()

    sources_by_intent = {}
    for i in intents:
        rows = conn.execute(
            "SELECT fact_id FROM intent_sources WHERE intent_id = ? AND project_id = ? ORDER BY rowid",
            (i["id"], project_id),
        ).fetchall()
        sources_by_intent[i["id"]] = [r["fact_id"] for r in rows]

    return proj, facts, hints, intents, sources_by_intent


def _export_yaml(conn, project_id: str) -> str:
    proj, facts, hints, intents, sources_by_intent = _load_project_data(conn, project_id)

    origin_desc = ""
    goal_desc = ""
    for f in facts:
        if f["id"] == "origin":
            origin_desc = f["description"]
        elif f["id"] == "goal":
            goal_desc = f["description"]

    data: dict = {
        "project": {
            "title": proj["title"],
            "origin": origin_desc,
            "goal": goal_desc,
        }
    }

    if hints:
        data["hints"] = [
            {
                "content": h["content"],
                "creator": h["creator"],
                "created_at": format_export_timestamp(h["created_at"]),
            }
            for h in hints
        ]

    data["facts"] = [{"id": f["id"], "description": f["description"]} for f in facts]

    intent_list = []
    for i in intents:
        entry: dict = {
            "from": sources_by_intent.get(i["id"], []),
            "to": i["to_fact_id"],
            "description": i["description"],
            "creator": i["creator"],
            "worker": i["worker"],
            "created_at": format_export_timestamp(i["created_at"]),
            "concluded_at": format_export_timestamp(i["concluded_at"]),
        }
        intent_list.append(entry)

    if intent_list:
        data["intents"] = intent_list

    return yaml.dump(data, allow_unicode=True, default_flow_style=False, sort_keys=False)


def _export_timeline(conn, project_id: str) -> str:
    proj, facts, hints, intents, sources_by_intent = _load_project_data(conn, project_id)

    facts_by_id = {f["id"]: f["description"] for f in facts}

    events: list[tuple[str, int, str]] = []  # (timestamp, order, text)
    order = 0

    origin_desc = facts_by_id.get("origin", "")
    goal_desc = facts_by_id.get("goal", "")
    ts = format_export_timestamp(proj["created_at"]) or ""
    block = f"[{ts}] PROJECT CREATED\n  origin: {origin_desc}\n  goal: {goal_desc}"
    events.append((proj["created_at"] or "", order, block))
    order += 1

    for h in hints:
        ts = format_export_timestamp(h["created_at"]) or ""
        block = f"[{ts}] HINT by {h['creator']}\n  {h['content']}"
        events.append((h["created_at"] or "", order, block))
        order += 1

    for i in intents:
        src = sources_by_intent.get(i["id"], [])
        from_str = ", ".join(src)

        ts = format_export_timestamp(i["created_at"]) or ""
        meta = f"  from: {from_str}"
        if i["worker"] and not i["concluded_at"]:
            meta += f"\n  worker: {i['worker']} (in progress)"
        block = f"[{ts}] INTENT DECLARED {i['id']} by {i['creator']}\n{meta}\n  {i['description']}"
        events.append((i["created_at"] or "", order, block))
        order += 1

        if not i["concluded_at"] or not i["to_fact_id"]:
            continue

        ts = format_export_timestamp(i["concluded_at"]) or ""
        actor = i["worker"] or i["creator"]

        if i["to_fact_id"] == "goal":
            block = f"[{ts}] PROJECT COMPLETED by {actor}\n  via: {i['id']} from {from_str}"
        else:
            fact_desc = facts_by_id.get(i["to_fact_id"], "")
            block = f"[{ts}] INTENT CONCLUDED {i['id']} by {actor}\n  from: {from_str}\n  produced: {i['to_fact_id']}\n  {fact_desc}"

        events.append((i["concluded_at"] or "", order, block))
        order += 1

    events.sort(key=lambda e: (e[0], e[1]))

    return "\n\n".join(e[2] for e in events) + "\n"


_PROJECT_STATUS_ZH = {
    "active": "进行中",
    "stopped": "已暂停",
    "completed": "已完成",
}


def _export_report_zh(conn, project_id: str) -> str:
    """生成项目的中文 Markdown 总结报告。

    报告涵盖项目元数据、起点/目标、提示、推导出的事实链、意图执行过程
    以及最终结论，便于回顾整个协同探索过程。
    """
    proj, facts, hints, intents, sources_by_intent = _load_project_data(conn, project_id)

    facts_by_id = {f["id"]: f["description"] for f in facts}
    origin_desc = facts_by_id.get("origin", "")
    goal_desc = facts_by_id.get("goal", "")

    intents_list = list(intents)
    intents_by_id = {i["id"]: i for i in intents_list}
    completing_intent = next(
        (i for i in intents_list if i["to_fact_id"] == "goal" and i["concluded_at"]),
        None,
    )
    fact_producer: dict[str, dict] = {}
    for i in intents_list:
        if i["to_fact_id"] and i["concluded_at"]:
            fact_producer[i["to_fact_id"]] = i

    status = proj["status"]
    status_zh = _PROJECT_STATUS_ZH.get(status, status)

    derived_facts = [f for f in facts if f["id"] not in ("origin", "goal")]
    open_intents = [i for i in intents_list if not i["concluded_at"]]
    concluded_intents = [i for i in intents_list if i["concluded_at"]]

    lines: list[str] = []
    lines.append(f"# 项目报告：{proj['title']}")
    lines.append("")
    lines.append("## 一、项目概览")
    lines.append("")
    lines.append(f"- **项目 ID**：`{proj['id']}`")
    lines.append(f"- **项目标题**：{proj['title']}")
    lines.append(f"- **当前状态**：{status_zh}")
    lines.append(f"- **创建时间**：{format_export_timestamp(proj['created_at']) or '未知'}")
    lines.append(f"- **事实总数**：{len(facts)}（含起点与目标，推导事实 {len(derived_facts)} 个）")
    lines.append(f"- **意图总数**：{len(intents_list)}（已结案 {len(concluded_intents)}，进行中 {len(open_intents)}）")
    lines.append(f"- **提示数量**：{len(hints)}")
    lines.append("")

    lines.append("## 二、起点与目标")
    lines.append("")
    lines.append("### 起点")
    lines.append("")
    lines.append(origin_desc.strip() if origin_desc else "_未提供起点描述_")
    lines.append("")
    lines.append("### 目标")
    lines.append("")
    lines.append(goal_desc.strip() if goal_desc else "_未提供目标描述_")
    lines.append("")

    lines.append("## 三、提示（Hints）")
    lines.append("")
    if hints:
        for idx, h in enumerate(hints, 1):
            ts = format_export_timestamp(h["created_at"]) or ""
            lines.append(f"{idx}. **{h['creator']}** · {ts}")
            content = (h["content"] or "").strip()
            for content_line in content.splitlines() or [""]:
                lines.append(f"   > {content_line}")
            lines.append("")
    else:
        lines.append("_暂无提示_")
        lines.append("")

    lines.append("## 四、事实清单")
    lines.append("")
    if derived_facts:
        for f in derived_facts:
            producer = fact_producer.get(f["id"])
            sources = sources_by_intent.get(producer["id"], []) if producer else []
            from_str = "、".join(sources) if sources else "—"
            worker = producer["worker"] if producer else "—"
            concluded_at = (
                format_export_timestamp(producer["concluded_at"]) if producer else "—"
            )
            lines.append(f"### {f['id']}")
            lines.append("")
            lines.append((f["description"] or "").strip() or "_无描述_")
            lines.append("")
            lines.append(
                f"- **来源意图**：`{producer['id'] if producer else '—'}`"
            )
            lines.append(f"- **基于事实**：{from_str}")
            lines.append(f"- **执行者**：{worker or '—'}")
            lines.append(f"- **结案时间**：{concluded_at or '—'}")
            lines.append("")
    else:
        lines.append("_除起点与目标之外，尚未推导出新的事实。_")
        lines.append("")

    lines.append("## 五、意图执行过程")
    lines.append("")
    if intents_list:
        for idx, i in enumerate(intents_list, 1):
            sources = sources_by_intent.get(i["id"], [])
            from_str = "、".join(sources) if sources else "—"
            created_at = format_export_timestamp(i["created_at"]) or "—"
            concluded_at = format_export_timestamp(i["concluded_at"]) or "—"
            if i["concluded_at"] and i["to_fact_id"]:
                if i["to_fact_id"] == "goal":
                    state = "已完成项目（导向 goal）"
                else:
                    state = f"已结案 → 产生事实 `{i['to_fact_id']}`"
            elif i["worker"]:
                state = f"进行中（执行者 {i['worker']}）"
            else:
                state = "未认领"

            lines.append(f"### {idx}. `{i['id']}` — {state}")
            lines.append("")
            lines.append((i["description"] or "").strip() or "_无描述_")
            lines.append("")
            lines.append(f"- **基于事实**：{from_str}")
            lines.append(f"- **提出人**：{i['creator']}")
            lines.append(f"- **执行者**：{i['worker'] or '—'}")
            lines.append(f"- **创建时间**：{created_at}")
            lines.append(f"- **结案时间**：{concluded_at}")
            if i["to_fact_id"] and i["concluded_at"] and i["to_fact_id"] != "goal":
                produced_desc = facts_by_id.get(i["to_fact_id"], "").strip()
                if produced_desc:
                    lines.append("- **产出事实摘要**：")
                    for line in produced_desc.splitlines():
                        lines.append(f"  > {line}")
            lines.append("")
    else:
        lines.append("_尚未声明任何意图。_")
        lines.append("")

    lines.append("## 六、最终结论")
    lines.append("")
    if status == "completed" and completing_intent:
        ts = format_export_timestamp(completing_intent["concluded_at"]) or "—"
        actor = completing_intent["worker"] or completing_intent["creator"] or "—"
        sources = sources_by_intent.get(completing_intent["id"], [])
        from_str = "、".join(sources) if sources else "—"
        lines.append(f"项目已于 **{ts}** 由 **{actor}** 通过意图 `{completing_intent['id']}` 完成。")
        lines.append("")
        lines.append("- **支撑事实**：" + from_str)
        lines.append("- **完成说明**：")
        completion_desc = (completing_intent["description"] or "").strip()
        for line in completion_desc.splitlines() or ["（未填写说明）"]:
            lines.append(f"  > {line}")
        lines.append("")
        lines.append("**目标达成情况：**")
        lines.append("")
        lines.append((goal_desc or "_未提供目标描述_").strip())
        lines.append("")
    elif status == "completed":
        lines.append("项目已标记为完成，但未找到指向 goal 的关键意图记录。")
        lines.append("")
    elif status == "stopped":
        lines.append("项目当前处于已暂停状态，尚未达成目标。")
        lines.append("")
    else:
        lines.append("项目仍在进行中，下面是当前进展。")
        lines.append("")
        if open_intents:
            lines.append("**待办与进行中的意图：**")
            lines.append("")
            for i in open_intents:
                state = f"执行者 {i['worker']}" if i["worker"] else "未认领"
                lines.append(f"- `{i['id']}` — {state}：{(i['description'] or '').strip()}")
            lines.append("")

    lines.append("---")
    lines.append("")
    lines.append(f"_报告自动生成时间：{datetime.now().astimezone().strftime('%Y-%m-%d %H:%M:%S')}_")
    lines.append("")
    return "\n".join(lines)


@router.get("/projects/{project_id}/export")
def export_project(project_id: str, format: str = "yaml"):
    if format not in ("yaml", "timeline", "report_zh"):
        raise HTTPException(400, "Supported formats: yaml, timeline, report_zh")

    with get_conn() as conn:
        if format == "timeline":
            text = _export_timeline(conn, project_id)
        elif format == "report_zh":
            text = _export_report_zh(conn, project_id)
        else:
            text = _export_yaml(conn, project_id)

        return Response(content=text, media_type="text/plain")
