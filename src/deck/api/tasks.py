"""任务：列表、详情、增删改，以及挂到任务上的消息。"""
from .. import actions
from . import PROJECT, not_found, op, shapes

_STATUS = "string 状态：todo / doing / review / done"
_FIELDS = {"project": PROJECT, "status": _STATUS, "priority": "string 优先级：low / medium / high / urgent",
           "due": "string 截止日期 YYYY-MM-DD", "description": "string 说明"}


@op("tasks.list", "GET", r"/api/tasks", "read", "任务列表：可按项目、状态筛选",
    params={"project": PROJECT, "status": _STATUS})
def list_tasks(ctx, args):
    rows = ctx.store.tasks(args.get("project") or None, args.get("status") or None)
    return {"tasks": [actions.task_dict(r) for r in rows]}


@op("tasks.create", "POST", r"/api/tasks", "write",
    "新建任务：title，可选 project、priority、due、description、source（来源消息）、message_ids（一起挂上的消息）",
    params={"title*": "string 标题", **_FIELDS, "message_ids": "integer[] 一起挂上的消息 id"})
def create_task(ctx, args):
    return {"task": actions.add_task(ctx.store, args)}


@op("tasks.get", "GET", r"/api/tasks/(?P<id>\d+)", "read", "任务详情和挂着的消息；已清理的消息列在 missing",
    params={"id*": "integer 任务 id"})
def get_task(ctx, args):
    store = ctx.store
    row = store.task(int(args["id"]))
    if not row:
        raise not_found("任务不存在")
    ids = store.task_message_ids(row["id"])
    rows = [r for r in (store.message(i) for i in ids) if r]
    present = {r["id"] for r in rows}
    return {"task": actions.task_dict(row), "messages": shapes.messages(store, rows),
            "missing": [i for i in ids if i not in present]}


@op("tasks.link", "POST", r"/api/tasks/(?P<id>\d+)/messages", "write", "把消息挂到任务上：message_ids 或 message_id",
    params={"id*": "integer 任务 id", "message_ids": "integer[] 消息 id", "message_id": "integer 单条消息 id"})
def link_messages(ctx, args):
    ids = args["message_ids"] if "message_ids" in args else [args.get("message_id")]
    return {"task": actions.link_task_message(ctx.store, int(args["id"]), ids)}


@op("tasks.unlink", "DELETE", r"/api/tasks/(?P<id>\d+)/messages/(?P<message>\d+)", "write",
    "从任务上取下一条消息（来源消息不能取下）", params={"id*": "integer 任务 id", "message*": "integer 消息 id"})
def unlink_message(ctx, args):
    return {"task": actions.unlink_task_message(ctx.store, int(args["id"]), int(args["message"]))}


@op("tasks.update", "POST", r"/api/tasks/(?P<id>\d+)", "write", "修改任务的标题、状态、优先级、截止日期等",
    params={"id*": "integer 任务 id", "title": "string 标题", **_FIELDS})
def update_task(ctx, args):
    body = {k: v for k, v in args.items() if k != "id"}
    return {"task": actions.update_task(ctx.store, int(args["id"]), body)}


@op("tasks.remove", "DELETE", r"/api/tasks/(?P<id>\d+)", "write", "删除任务", params={"id*": "integer 任务 id"})
def remove_task(ctx, args):
    actions.remove_task(ctx.store, int(args["id"]))
    return {"ok": True}
