"""版本号、配置、操作日志与 AI。"""
from .. import actions, ai, logview
from .. import config as config_module
from ..adapters import MARKS_AI, SOURCES
from . import int_arg, op, required_int, shapes


@op("version", "GET", r"/api/version", "read",
    "各类数据的版本：内容变了才变；parts.health 是监听状态。用来判断要不要重新拉取")
def version(ctx, args):
    parts = ctx.store.versions()
    return {"version": shapes.digest(parts), "parts": {**parts, "health": shapes.health_version(ctx)},
            "audit": ctx.store.audit_head()}


def _editable(config) -> dict:
    return {k: getattr(config, k) for k in config_module.EDITABLE}


@op("config.get", "GET", r"/api/config", "read", "可调整的设置、config.toml 中的默认值，以及改过哪些")
def get_config(ctx, args):
    return {**_editable(ctx.config),
            "defaults": config_module.file_defaults(ctx.config.home),
            "overridden": sorted(ctx.store.setting("runtime_config")),
            "marks_ai": sorted(MARKS_AI), "sources": list(SOURCES)}


@op("config.update", "POST", r"/api/config", "write", "修改设置；reset 列出要恢复默认的项")
def update_config(ctx, args):
    merged = actions.configure(ctx.store, args)
    ctx.config = config_module.current(ctx.config, merged)
    ctx.wake_watcher()
    return {"config": _editable(ctx.config)}


@op("log.query", "GET", r"/api/log", "read", "操作日志：可按类别、失败、执行者、关键词、时间筛选")
def query_log(ctx, args):
    rows, more = logview.query(
        ctx.store, category=args.get("category") or None, failed=str(args.get("failed")) == "1",
        actor=args.get("actor") or None, search=str(args.get("q", "")), since=args.get("since") or None,
        before=int_arg(args, "before"), limit=int_arg(args, "limit", 50), noise=str(args.get("noise")) != "0")
    describe = logview.Describer(ctx.store)
    return {"entries": [describe(r) for r in rows], "has_more": more,
            "categories": [{"id": k, "label": v[0]} for k, v in logview.CATEGORIES.items()]}


@op("ai.settings", "GET", r"/api/ai/settings", "read", "AI 功能开关、模型与用量")
def ai_settings(ctx, args):
    return {"settings": ai.settings(ctx.store)}


@op("ai.configure", "POST", r"/api/ai/settings", "write", "修改 AI 设置", web_only=True)
def ai_configure(ctx, args):
    return {"settings": ai.configure(ctx.store, args)}


@op("ai.ask", "POST", r"/api/ai/ask", "write", "就群消息向 AI 提问（消耗预算）", web_only=True)
def ai_ask(ctx, args):
    return ai.ask(ctx.store, ctx.config, args.get("question", ""), args.get("project") or None, args.get("group"))


@op("ai.draft", "POST", r"/api/ai/draft", "write", "让 AI 起草对某条消息的回复（只起草，不发送）", web_only=True)
def ai_draft(ctx, args):
    return ai.draft(ctx.store, ctx.config, required_int(args, "message_id"), args.get("instruction") or "")
