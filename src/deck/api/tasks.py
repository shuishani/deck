"""任务：列表、详情、增删改，以及挂到任务上的消息。"""
from .. import actions
from . import not_found, op, shapes


@op("tasks.list", "GET", r"/api/tasks", "read", "任务列表：可按项目、状态筛选")
def list_tasks(ctx, args):
    rows = ctx.store.tasks(args.get("project") or None, args.get("status") or None)
    return {"tasks": [actions.task_dict(r) for r in rows]}


@op("tasks.create", "POST", r"/api/tasks", "write",
    "新建任务：title，可选 project、priority、due、description、source（来源消息）、message_ids（一起挂上的消息）")
def create_task(ctx, args):
    return {"task": actions.add_task(ctx.store, args)}


@op("tasks.get", "GET", r"/api/tasks/(?P<id>\d+)", "read", "任务详情和挂着的消息；已清理的消息列在 missing")
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


@op("tasks.link", "POST", r"/api/tasks/(?P<id>\d+)/messages", "write", "把消息挂到任务上：message_ids 或 message_id")
def link_messages(ctx, args):
    ids = args["message_ids"] if "message_ids" in args else [args.get("message_id")]
    return {"task": actions.link_task_message(ctx.store, int(args["id"]), ids)}


@op("tasks.unlink", "DELETE", r"/api/tasks/(?P<id>\d+)/messages/(?P<message>\d+)", "write",
    "从任务上取下一条消息（来源消息不能取下）")
def unlink_message(ctx, args):
    return {"task": actions.unlink_task_message(ctx.store, int(args["id"]), int(args["message"]))}


@op("tasks.update", "POST", r"/api/tasks/(?P<id>\d+)", "write", "修改任务的标题、状态、优先级、截止日期等")
def update_task(ctx, args):
    body = {k: v for k, v in args.items() if k != "id"}
    return {"task": actions.update_task(ctx.store, int(args["id"]), body)}


@op("tasks.remove", "DELETE", r"/api/tasks/(?P<id>\d+)", "write", "删除任务")
def remove_task(ctx, args):
    actions.remove_task(ctx.store, int(args["id"]))
    return {"ok": True}
