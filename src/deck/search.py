"""本地已同步消息的完整文本查询，独立于最近消息时间线。"""

import base64
import binascii
import json

from .store import Store, _MESSAGE_SELECT


def messages(store: Store, config, q: str, project: str | None = None, group: int | None = None,
             cursor: str | None = None, limit: int = 30) -> dict:
    if not isinstance(q, str) or len(q) > 200:
        raise ValueError("搜索词不能超过 200 字")
    q = q.strip()
    if not q:
        return {"hits": [], "next_cursor": None}
    limit = max(1, min(limit, 100))
    where = ["m.text LIKE ? ESCAPE '\\'", "m.retracted_at IS NULL",
             "json_extract(m.raw, '$.deleted_at') IS NULL"]
    pattern = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    args = [f"%{pattern}%"]
    if project:
        where.append("c.project = ?")
        args.append(project)
    if group is not None:
        where.append("m.conversation = ?")
        args.append(group)
    scope = [q, project, group]
    if cursor:
        try:
            if len(cursor) > 4096:
                raise ValueError()
            data = json.loads(base64.urlsafe_b64decode(cursor.encode()))
            if data["scope"] != scope or not isinstance(data["at"], str) or type(data["id"]) is not int:
                raise ValueError()
        except (ValueError, TypeError, KeyError, UnicodeError, binascii.Error):
            raise ValueError("搜索游标无效或与当前范围不一致，请重新搜索") from None
        where.append("(m.sent_at, m.id) < (?, ?)")
        args.extend([data["at"], data["id"]])
    rows = store.db.execute(_MESSAGE_SELECT + " WHERE " + " AND ".join(where)
                            + " ORDER BY m.sent_at DESC, m.id DESC LIMIT ?", [*args, limit + 1]).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if more:
        next_cursor = base64.urlsafe_b64encode(json.dumps({"scope": scope, "at": rows[-1]["sent_at"],
                                                         "id": rows[-1]["id"]}).encode()).decode()
    # 在函数里导入：api 包加载时会导入本模块。
    from .api.shapes import messages

    hits = []
    for message in messages(store, rows):
        text = message["text"]
        at = text.casefold().find(q.casefold())
        start = max(0, at - 30)
        excerpt = ("…" if start else "") + text[start:start + 180]
        hits.append({"message": message, "excerpt": excerpt})
    return {"hits": hits, "next_cursor": next_cursor}


def around(store: Store, id: int, group: int | None = None, project: str | None = None,
           limit: int = 50, mine: bool = False) -> list:
    target = store.message(id)
    if not target or (group is not None and target["conversation"] != group) or (project and target["project"] != project):
        raise LookupError("消息不存在或不属于当前范围，可能已被清理")
    limit = max(1, min(limit, 200))
    before = store.timeline(project=project, conversation=group, mine=mine, before=id, limit=limit // 2)
    where = ["(m.sent_at, m.id) > (?, ?)"]
    args = [target["sent_at"], target["id"]]
    if group is not None:
        where.append("m.conversation = ?")
        args.append(group)
    if project:
        where.append("c.project = ?")
        args.append(project)
    if mine:
        where.append("m.is_me = 1")
    after = store.db.execute(_MESSAGE_SELECT + " WHERE " + " AND ".join(where)
                            + " ORDER BY m.sent_at, m.id LIMIT ?", [*args, max(0, limit - len(before) - 1)]).fetchall()
    return [*before, target, *after]
