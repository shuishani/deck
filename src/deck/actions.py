import json
from collections.abc import Callable
from datetime import date
from sqlite3 import Row

from .adapters import MARKS_AI, SOURCES, Adapter
from .config import EDITABLE, Config, validate_settings
from . import rules, uploads
from .runner import ToolError
from .store import Store
from .sync import sync

AdapterFor = Callable[[str], Adapter]

KINDS = ("test", "prod")
TASK_STATUSES = ("todo", "doing", "review", "done")
TASK_PRIORITIES = ("low", "medium", "high", "urgent")
_TASK_SOURCE = {"group_id": int, "group_name": str, "message_id": int,
                "sender_name": str, "text": str}


def add_project(store: Store, key: str, name: str, repo: str | None) -> None:
    if not key.strip() or not name.strip():
        raise ValueError("项目简称和名称不能为空")
    store.add_project(key.strip(), name.strip(), repo or None)
    store.audit("me", "project.add", key, {"name": name, "repo": repo}, "ok")


def update_project(store: Store, key: str, data: dict) -> Row:
    if not store.project(key):
        raise LookupError("项目不存在")
    if set(data) - {"name", "repo"}:
        raise ValueError("只允许修改项目名称和仓库，项目简称保持不变")
    fields = {}
    for field in data:
        value = data[field]
        if value is not None and not isinstance(value, str):
            raise ValueError("项目名称和仓库须为文本")
        value = value.strip() if value else None
        if field == "name" and (not value or len(value) > 200):
            raise ValueError("项目名称不能为空且不能超过 200 字")
        fields[field] = value
    store.update_project(key, fields)
    store.audit("me", "project.update", key, fields, "ok")
    return store.project(key)


def move_group(store: Store, id: int, project: str) -> Row:
    row = store.conversation(id)
    if not row:
        raise LookupError("群不存在")
    if not store.project(project):
        raise ValueError("目标项目不存在")
    store.move_conversation(id, project)
    store.audit("me", "group.move", str(id), {"from": row["project"], "to": project}, "ok")
    return store.conversation(id)


def add_group(store: Store, adapter_for: AdapterFor, project: str, source: str, query: str) -> Row:
    if not store.project(project):
        raise ValueError(f"项目 {project} 不存在，请先登记")
    conversation = adapter_for(source).resolve(query.strip())
    id = store.add_conversation(project, conversation)
    store.audit("me", "group.add", f"{conversation.source}:{conversation.remote_id}",
                {"project": project, "name": conversation.name}, "ok")
    return store.conversation(id)


def remove_group(store: Store, id: int) -> Row:
    row = store.conversation(id)
    if not row or not store.remove_conversation(id):
        raise ValueError(f"群 {id} 不存在")
    store.audit("me", "group.remove", f"{row['source']}:{row['remote_id']}",
                {"name": row["name"]}, "ok")
    return row


def set_group_kind(store: Store, id: int, kind: str) -> Row:
    if kind not in KINDS:
        raise ValueError("群类型须为 test（测试）或 prod（正式）")
    row = store.conversation(id)
    if not row or not store.set_kind(id, kind):
        raise ValueError(f"群 {id} 不存在")
    store.audit("me", "group.kind", f"{row['source']}:{row['remote_id']}",
                {"name": row["name"], "kind": kind}, "ok")
    return store.conversation(id)


def configure(store: Store, data: dict) -> dict:
    """reset 里的字段去掉覆盖值，回到 config.toml 的默认值。"""
    data = dict(data)
    reset = data.pop("reset", None) or []
    if not isinstance(reset, list) or set(reset) - set(EDITABLE):
        raise ValueError(f"只能恢复这些设置的默认值：{', '.join(EDITABLE)}")
    values = validate_settings(data)
    merged = store.update_settings(values, reset)
    store.audit("me", "config.update", "settings",
                {"fields": sorted(values), **({"reset": sorted(reset)} if reset else {})}, "ok")
    return merged


def set_group_rules(store: Store, id: int, data: dict) -> dict:
    if not store.conversation(id):
        raise LookupError("群不存在")
    rule = rules.validate(data)
    store.set_rules(id, rule)
    store.audit("me", "group.rules", str(id), rule, "ok")
    return rule


def set_source_paused(store: Store, source: str, paused: bool) -> None:
    if source not in SOURCES:
        raise ValueError(f"未知的平台：{source}")
    store.set_source_paused(source, paused)
    store.audit("me", "source.pause" if paused else "source.resume", source, {}, "ok")


# --- 任务 ---


def task_dict(row: Row) -> dict:
    return {**dict(row), "source": json.loads(row["source"]) if row["source"] else None}


def _task_fields(store: Store, data: dict) -> dict:
    """只取认识的字段，逐个检查；没给的字段不出现在结果里。"""
    fields = {}
    if "title" in data:
        title = str(data["title"] or "").strip()
        if not title:
            raise ValueError("任务标题不能为空")
        if len(title) > 200:
            raise ValueError("任务标题不能超过 200 字")
        fields["title"] = title
    if "description" in data:
        fields["description"] = str(data["description"] or "").strip()
    if "project" in data:
        project = str(data["project"] or "").strip() or None
        if project and not store.project(project):
            raise ValueError(f"项目 {project} 不存在")
        fields["project"] = project
    if "status" in data:
        if data["status"] not in TASK_STATUSES:
            raise ValueError(f"状态须为 {' / '.join(TASK_STATUSES)} 之一")
        fields["status"] = data["status"]
    if "priority" in data:
        if data["priority"] not in TASK_PRIORITIES:
            raise ValueError(f"优先级须为 {' / '.join(TASK_PRIORITIES)} 之一")
        fields["priority"] = data["priority"]
    if "due" in data:
        due = str(data["due"] or "").strip() or None
        if due:
            try:
                due = date.fromisoformat(due).isoformat()
            except ValueError as error:
                raise ValueError("截止日期格式应为 YYYY-MM-DD") from error
        fields["due"] = due
    if "source" in data:
        source = data["source"]
        if source is not None:
            if not isinstance(source, dict):
                raise ValueError("任务来源格式无效")
            try:
                source = {k: kind(source[k]) for k, kind in _TASK_SOURCE.items()}
            except (KeyError, TypeError, ValueError) as error:
                raise ValueError("任务来源缺少字段或格式无效") from error
        fields["source"] = json.dumps(source, ensure_ascii=False) if source else None
    return fields


def add_task(store: Store, data: dict, actor: str = "me") -> dict:
    fields = {"description": "", "project": None, "status": "todo", "priority": "medium",
              "due": None, "source": None, **_task_fields(store, data)}
    if "title" not in fields:
        raise ValueError("任务标题不能为空")
    extra = _message_ids(store, data.get("message_ids") or [])
    id = store.add_task({**fields, "created_by": actor})
    for message in extra:
        store.link_task_message(id, message, actor)
    store.audit(actor, "task.add", f"task:{id}",
                {"title": fields["title"], "project": fields["project"],
                 **({"messages": len(extra)} if extra else {})}, "ok")
    return task_dict(store.task(id))


def _message_ids(store: Store, values) -> list[int]:
    if not isinstance(values, list) or len(values) > 100:
        raise ValueError("消息列表格式无效（最多 100 条）")
    try:
        ids = list(dict.fromkeys(int(v) for v in values))
    except (TypeError, ValueError) as error:
        raise ValueError("消息编号无效") from error
    missing = [i for i in ids if not store.message(i)]
    if missing:
        raise ValueError(f"消息 {', '.join(map(str, missing))} 不在本地")
    return ids


def update_task(store: Store, id: int, data: dict, actor: str = "me") -> dict:
    before = store.task(id)
    if not before:
        raise ValueError(f"任务 {id} 不存在")
    fields = _task_fields(store, data)
    changed = {k: v for k, v in fields.items() if before[k] != v}
    if changed:
        store.update_task(id, changed)
        if changed.get("source"):
            store.link_task_message(id, json.loads(changed["source"])["message_id"], actor)
        detail = {"title": before["title"],
                  **{k: v for k, v in changed.items() if k not in ("description", "source")}}
        store.audit(actor, "task.update", f"task:{id}", detail, "ok")
    return task_dict(store.task(id))


def link_task_message(store: Store, id: int, message: int | list[int], actor: str = "me") -> dict:
    task = store.task(id)
    if not task:
        raise ValueError(f"任务 {id} 不存在")
    ids = _message_ids(store, message if isinstance(message, list) else [message])
    added = [i for i in ids if store.link_task_message(id, i, actor)]
    if added:
        store.audit(actor, "task.link", f"task:{id}", {"title": task["title"], "messages": added}, "ok")
    return task_dict(store.task(id))


def unlink_task_message(store: Store, id: int, message: int, actor: str = "me") -> dict:
    task = store.task(id)
    if not task:
        raise ValueError(f"任务 {id} 不存在")
    source = json.loads(task["source"]) if task["source"] else None
    if source and source["message_id"] == message:
        raise ValueError("这是任务的来源消息，不能移出")
    if not store.unlink_task_message(id, message):
        raise ValueError(f"消息 {message} 不在任务 {id} 中")
    store.audit(actor, "task.unlink", f"task:{id}", {"title": task["title"], "message": message}, "ok")
    return task_dict(store.task(id))


def remove_task(store: Store, id: int, actor: str = "me") -> dict:
    row = store.task(id)
    if not row or not store.remove_task(id):
        raise ValueError(f"任务 {id} 不存在")
    store.audit(actor, "task.remove", f"task:{id}", {"title": row["title"]}, "ok")
    return task_dict(row)


# --- 发消息 ---


def plan_send(store: Store, config: Config, group: int, text: str,
              reply_to: str | None, ai: bool, attachments: list[dict] | None = None) -> tuple[Row, dict]:
    row = store.conversation(group)
    if not row:
        raise ValueError(f"群 {group} 不存在")
    if not text.strip() and not attachments:
        raise ValueError("消息内容不能为空")
    final = f"{config.ai_prefix}{text}" if text and ai and row["source"] not in MARKS_AI else text
    notice = None
    if attachments:
        caps = uploads.capabilities(row["source"])
        if reply_to and not caps["reply_attachments"]:
            raise ValueError("该平台不支持带附件的引用回复，请取消引用后发送")
        if row["source"] == "dingtalk" and text and attachments[0]["kind"] == "file":
            notice = "钉钉将先发送文字、再发送文件，共两条消息；部分失败时请核实，不会自动重发。"
    if reply_to and row["source"] == "channel":
        # channel 的回复挂在话题根消息下；回复话题里的某条，就回到它所在的话题。
        target = store.message_by_remote(row["id"], reply_to)
        if target and target["reply_to"]:
            reply_to = target["reply_to"]
    plan = {"group": row["name"], "source": row["source"], "kind": row["kind"],
            "text": final, "reply_to": reply_to, "notice": notice}
    if attachments:
        plan["attachments"] = uploads.public(attachments)
    return row, plan


def send(store: Store, config: Config, adapter_for: AdapterFor, group: int, text: str,
         reply_to: str | None, ai: bool, handle: int | None = None,
         attachments: list[dict] | None = None) -> dict:
    """真的发出去：记审计，把回复的那条标为已处理，再回读一次让它进时间线。"""
    row, plan = plan_send(store, config, group, text, reply_to, ai, attachments)
    # 执行者始终是我；以 AI 身份发送记在详情里，和以后 AI 自动执行区分开。
    actor = "me"
    target = f"{row['source']}:{row['remote_id']}"
    plan = {**plan, "ai": True} if ai else plan
    # 必须在发送前取：钉钉实时监听可能在发送命令返回前就把这条同步进库了。
    latest = store.latest_message_id(row["id"])
    try:
        adapter = adapter_for(row["source"])
        if attachments:
            uploads.send(adapter, row["remote_id"], plan["text"], plan["reply_to"], ai, attachments)
        else:
            adapter.send(row["remote_id"], plan["text"], plan["reply_to"], ai=ai)
    except Exception as error:
        detail = str(error) if isinstance(error, (ToolError, ValueError)) else type(error).__name__
        store.audit(actor, "message.send", target, plan, f"error: {detail}")
        raise
    store.audit(actor, "message.send", target, plan, "ok")
    if handle is not None:
        store.set_handled(handle, True)
    results = sync(store, adapter_for, conversation=row["id"])
    # 带附件时平台可能拆成多条（钉钉文字和文件分开发），文字也可能被改写成 Markdown，不能只按文字匹配。
    match = None if attachments else plan["text"]
    readback = store.sent_message(row["id"], after=latest, text=match)
    sync_error = next((r.error for r in results if r.error), None)
    if not readback and not sync_error:
        sync_error = "平台已接受消息，尚未回读到本地，请勿重复发送"
    if ai:
        # 平台数据里分不出哪条是以 AI 身份发的，在本地记下来。
        store.mark_ai_sent(row["id"], after=latest, text=match)
    return {"status": "sent", "sent": True, "message_id": readback["id"] if readback else None,
            "sync_error": sync_error}


def _own_message(store: Store, id: int) -> Row:
    row = store.message(id)
    if not row:
        raise ValueError(f"消息 {id} 不存在")
    if not row["is_me"]:
        raise ValueError("只能编辑或撤回自己发的消息")
    if is_retracted(row):
        raise ValueError("这条消息已撤回")
    return row


def is_retracted(row: Row) -> bool:
    raw = json.loads(row["raw"] or "{}") if isinstance(row["raw"], str) else row["raw"] or {}
    return bool(row["retracted_at"] or raw.get("deleted_at"))


def plan_edit(store: Store, id: int, text: str) -> tuple[Row, dict]:
    row = _own_message(store, id)
    if not text.strip():
        raise ValueError("消息内容不能为空")
    return row, {"group": row["conversation_name"], "source": row["source"],
                 "kind": store.conversation(row["conversation"])["kind"], "text": text,
                 "reply_to": None, "notice": "将修改已发送的消息，群内成员会看到「已编辑」"}


def edit_message(store: Store, adapter_for: AdapterFor, id: int, text: str) -> None:
    row, plan = plan_edit(store, id, text)
    target = f"{row['source']}:{row['remote_id']}"
    adapter = adapter_for(row["source"])
    conversation = store.conversation(row["conversation"])["remote_id"]
    raw = json.loads(row["raw"] or "{}")
    try:
        adapter.edit(conversation, raw, text)
    except ToolError as error:
        store.audit("me", "message.edit", target, {"group": row["conversation_name"], "text": text}, f"error: {error}")
        raise
    store.audit("me", "message.edit", target, {"group": row["conversation_name"], "before": row["text"], "text": text}, "ok")
    store.mark_edited(id)
    fresh = adapter.refetch(conversation, raw)
    store.update_message(id, fresh.text if fresh else text, fresh.raw if fresh else raw)


def retract_message(store: Store, adapter_for: AdapterFor, id: int) -> None:
    row = _own_message(store, id)
    target = f"{row['source']}:{row['remote_id']}"
    conversation = store.conversation(row["conversation"])["remote_id"]
    try:
        adapter_for(row["source"]).retract(conversation, json.loads(row["raw"] or "{}"))
    except ToolError as error:
        store.audit("me", "message.retract", target, {"group": row["conversation_name"], "text": row["text"]}, f"error: {error}")
        raise
    store.audit("me", "message.retract", target, {"group": row["conversation_name"], "text": row["text"]}, "ok")
    store.mark_retracted(id)


def mark_read(store: Store, id: int) -> None:
    """把群读到最新一条；已读只记本地，不写操作日志。"""
    if not store.mark_read(id):
        raise LookupError("群不存在")


def set_handled(store: Store, id: int, handled: bool) -> None:
    row = store.message(id)
    if not row:
        raise ValueError(f"消息 {id} 不存在")
    store.set_handled(id, handled)
    store.audit("me", "message.handle" if handled else "message.unhandle",
                f"{row['source']}:{row['remote_id']}",
                {"group": row["conversation_name"], "sender": row["sender_name"]}, "ok")
