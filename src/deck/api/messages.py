"""消息：概览、时间线、待处理、单条消息的处理/编辑/撤回、媒体、搜索、发送、附件。"""
from pathlib import Path

from .. import actions, media, search, sending, uploads
from ..adapters import SOURCES
from ..attention import attention
from . import PROJECT, bool_arg, int_arg, not_found, op, required_int, shapes


@op("overview", "GET", r"/api/overview", "read", "各项目与群的概况：未读、待回复、最新一条、监听状态")
def overview(ctx, args):
    return shapes.overview(ctx)


@op("messages.search", "GET", r"/api/search", "read", "全文搜索消息，按时间倒序分页",
    params={"q*": "string 关键词", "project": PROJECT, "group": "integer 群 id",
            "cursor": "string 上一页返回的 next_cursor", "limit": "integer 条数，默认 30"})
def search_messages(ctx, args):
    return search.messages(ctx.store, ctx.config, str(args.get("q", "")), args.get("project") or None,
                           int_arg(args, "group"), args.get("cursor"), int_arg(args, "limit", 30))


@op("messages.timeline", "GET", r"/api/timeline", "read",
    "消息时间线：可按项目或群筛选；before 向前翻页，around 定位到某条消息附近",
    params={"project": PROJECT, "group": "integer 群 id", "mine": "boolean 只看我发的",
            "limit": "integer 条数，默认 50，最多 200", "before": "integer 消息 id，取比它更早的",
            "around": "integer 消息 id，取它附近的"})
def timeline(ctx, args):
    store = ctx.store
    project = args.get("project") or None
    group = int_arg(args, "group")
    mine = bool_arg(args, "mine")
    limit = max(1, min(int_arg(args, "limit", 50), 200))
    if args.get("around"):
        rows = search.around(store, int_arg(args, "around", 0), group=group, project=project, limit=limit, mine=mine)
        return {"messages": shapes.messages(store, rows),
                "has_more": bool(rows and store.timeline(project=project, conversation=group,
                                                         before=rows[0]["id"], limit=1))}
    rows = store.timeline(project=project, conversation=group, mine=mine, limit=limit + 1,
                          before=int_arg(args, "before"))
    has_more = len(rows) > limit
    rows = rows[1:] if has_more else rows
    reasons = {a.message["id"]: a.reason for a in attention(store, ctx.config, project)}
    return {"messages": shapes.messages(store, rows, reasons), "has_more": has_more}


@op("messages.attention", "GET", r"/api/attention", "read",
    "需要我处理的消息：@我 未回复、疑似问题；含等待时长和是否超时", params={"project": PROJECT})
def attention_list(ctx, args):
    items = list(reversed(attention(ctx.store, ctx.config, args.get("project") or None)))
    shaped = shapes.messages(ctx.store, [a.message for a in items], {a.message["id"]: a.reason for a in items})
    return {"messages": [{**m, "waiting_minutes": a.waiting_minutes, "overdue": a.overdue}
                         for m, a in zip(shaped, items)]}


@op("messages.get", "GET", r"/api/messages/(?P<id>\d+)", "read", "单条消息", params={"id*": "integer 消息 id"})
def get_message(ctx, args):
    row = ctx.store.message(int(args["id"]))
    if not row:
        raise not_found("原消息已不在本地（可能已过保留期限）")
    return {"message": shapes.messages(ctx.store, [row])[0]}


@op("messages.handled", "POST", r"/api/messages/(?P<id>\d+)/handled", "write", "标记消息已处理或取消",
    params={"id*": "integer 消息 id", "handled": "boolean 默认 true；false 取消已处理"})
def set_handled(ctx, args):
    actions.set_handled(ctx.store, int(args["id"]), bool(args.get("handled", True)))
    return {"ok": True}


@op("messages.edit", "POST", r"/api/messages/(?P<id>\d+)/edit", "send",
    "编辑自己发的消息：不带 confirm 只返回预览，带 confirm 才改到平台上",
    params={"id*": "integer 消息 id（只能是自己发的）", "text*": "string 修改后的全文"})
def edit_message(ctx, args):
    id, text = int(args["id"]), str(args.get("text", "")).strip()
    if not args.get("confirm"):
        return {"preview": actions.plan_edit(ctx.store, id, text)[1]}
    actions.edit_message(ctx.store, ctx.adapter_for, id, text)
    return {"ok": True}


@op("messages.retract", "POST", r"/api/messages/(?P<id>\d+)/retract", "send",
    "撤回自己发的消息：不带 confirm 只返回预览，带 confirm 才撤回", params={"id*": "integer 消息 id（只能是自己发的）"})
def retract_message(ctx, args):
    if not args.get("confirm"):
        return {"preview": actions.plan_retract(ctx.store, int(args["id"]))[1]}
    actions.retract_message(ctx.store, ctx.adapter_for, int(args["id"]))
    return {"ok": True}


@op("messages.media", "GET", r"/api/media/(?P<id>\d+)/(?P<index>\d+)", "read", "消息里的图片、语音、文件",
    web_only=True)
def get_media(ctx, args):
    return media.get(ctx.store, ctx.adapter_for, int(args["id"]), int(args["index"]))


@op("groups.read", "POST", r"/api/groups/(?P<id>\d+)/read", "write", "把群标为已读到最新一条",
    params={"id*": "integer 群 id"})
def mark_read(ctx, args):
    actions.mark_read(ctx.store, int(args["id"]))
    return {"ok": True}


@op("messages.send", "POST", r"/api/send", "send",
    "发消息：先不带 confirm 拿到预览和 operation_id，再带 confirm 与 operation_id 确认发送",
    params={"group*": "integer 群 id", "text*": "string 消息正文",
            "reply_to": "string 引用回复：被回复消息的 remote_id", "ai": "boolean 以 AI 身份发送（加前缀），默认 false",
            "handle": "integer 发送后标为已处理的消息 id（须在同一个群）"})
def send(ctx, args):
    if args.get("confirm"):
        id = args.get("operation_id")
        if not isinstance(id, str) or not id:
            raise ValueError("确认发送须提供预览返回的 operation_id")
        return sending.confirm(ctx.store, ctx.config, ctx.adapter_for, ctx.owner, id, args)
    payload = {"group": required_int(args, "group"), "text": str(args.get("text", "")),
               "reply_to": args.get("reply_to") or None, "ai": bool(args.get("ai")),
               "handle": int_arg(args, "handle"), "attachments": args.get("attachments", [])}
    return {"preview": sending.preview(ctx.store, ctx.config, ctx.owner, payload)}


@op("uploads.capabilities", "GET", r"/api/capabilities", "read", "各平台支持发送的附件类型")
def capabilities(ctx, args):
    return {"sources": {source: uploads.capabilities(source) for source in SOURCES}}


@op("uploads.create", "POST", r"/api/uploads", "write", "上传附件（请求体是文件原始内容）",
    web_only=True, raw_body=True)
def create_upload(ctx, args):
    group = int_arg(args, "group")
    if group is None or not ctx.store.conversation(group):
        raise ValueError("群不存在")
    data = ctx.http.read_upload(uploads.MAX_BYTES)
    return {"attachment": uploads.create(ctx.store, ctx.config, ctx.owner, group, str(args.get("name", "")), data)}


@op("uploads.get", "GET", r"/api/uploads/(?P<id>[a-zA-Z0-9-]+)", "read", "预览自己上传的附件", web_only=True)
def get_upload(ctx, args):
    item = uploads.get(ctx.store, ctx.owner, args["id"])
    if not item:
        raise LookupError("附件不存在")
    return media.Media(Path(item["path"]), item["mime"], item["name"], item["kind"] == "image")

