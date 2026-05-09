from fastapi import APIRouter, HTTPException

from cairn.server.db import get_conn
from cairn.server.models import CreateReportRequest, ProjectReport
from cairn.server.services import get_project_or_404, utcnow

router = APIRouter(tags=["reports"])


def _row_to_report(row) -> ProjectReport:
    return ProjectReport(
        id=row["id"],
        project_id=row["project_id"],
        content=row["content"],
        generator=row["generator"],
        created_at=row["created_at"],
    )


@router.post(
    "/projects/{project_id}/report",
    response_model=ProjectReport,
    status_code=201,
)
def create_report(project_id: str, body: CreateReportRequest):
    """追加一份项目报告。

    一个项目可以有多份报告（例如 reopen 后再次完成会再写一份）。
    服务端不会覆盖旧报告。前端读取时默认拿最新一条。
    """
    with get_conn() as conn:
        get_project_or_404(conn, project_id)
        now = utcnow()
        cursor = conn.execute(
            """
            INSERT INTO project_reports (project_id, content, generator, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (project_id, body.content, body.generator, now),
        )
        row = conn.execute(
            "SELECT * FROM project_reports WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        assert row is not None
        return _row_to_report(row)


@router.get(
    "/projects/{project_id}/report",
    response_model=ProjectReport,
)
def get_latest_report(project_id: str):
    """获取项目的最新一份报告。没有则 404。"""
    with get_conn() as conn:
        get_project_or_404(conn, project_id)
        row = conn.execute(
            """
            SELECT * FROM project_reports
            WHERE project_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            (project_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Report not found")
        return _row_to_report(row)


@router.get(
    "/projects/{project_id}/reports",
    response_model=list[ProjectReport],
)
def list_reports(project_id: str):
    """按时间倒序列出该项目的全部历史报告。"""
    with get_conn() as conn:
        get_project_or_404(conn, project_id)
        rows = conn.execute(
            """
            SELECT * FROM project_reports
            WHERE project_id = ?
            ORDER BY created_at DESC, id DESC
            """,
            (project_id,),
        ).fetchall()
        return [_row_to_report(r) for r in rows]
