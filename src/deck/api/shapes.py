"""对外返回的数据形状：网页、命令行、MCP 共用，改动即是改契约。"""
import hashlib
import json
from datetime import datetime

from .. import actions, content, rules
from ..attention import attention
from ..store import Store


def digest(value) -> str:
    return hashlib.sha1(repr(value).encode()).hexdigest()[:12]


def project(row) -> dict:
    return {"key": row["key"], "name": row["name"], "repo": row["repo"]}


def group(ctx, row, paused: set[str]) -> dict:
    if row["mode"] == "off":
        mode, error = "off", None
    elif row["source"] in paused:
        mode, error = "paused", None
    else:
        mode, listen_error = ctx.watcher.status(row["id"]) if ctx.watcher else ("poll", None)
        error = row["last_error"] or listen_error
    return {
        "id": row["id"], "project": row["project"], "source": row["source"],
        "name": row["name"], "kind": row["kind"], "remote_id": row["remote_id"],
        "mode": row["mode"], "chat": row["chat"],
        "added_at": row["added_at"], "rules": rules.decode(row["rules"]),
        "watch": {"mode": mode, "last_sync_at": row["last_sync_at"], "error": error},
    }


def health_version(ctx) -> str:
    """监听状态：暂停、出错、实时/轮询切换时才变；每次同步的时间不算。"""
    rows = [(r["id"], r["last_error"], ctx.watcher.status(r["id"]) if ctx.watcher else None)
            for r in ctx.store.conversations()]
    return digest((sorted(ctx.store.paused_sources()), rows))


def overview(ctx) -> dict:
    store = ctx.store
    midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    stats = store.group_stats(midnight)
    unread = store.unread_counts()
    paused = store.paused_sources()
    counts: dict[tuple[int, str], int] = {}
    for item in attention(store, ctx.config):
        key = (item.message["conversation"], item.reason)
        counts[key] = counts.get(key, 0) + 1
    projects = []
    for row in store.projects():
        groups = []
        for conversation in store.conversations(row["key"]):
            stat = stats.get(conversation["id"], {})
            last = stat.get("last_message")
            groups.append({
                **group(ctx, conversation, paused),
                "today_count": stat.get("today_count", 0),
                "awaiting_count": counts.get((conversation["id"], "mention"), 0),
                "issue_count": counts.get((conversation["id"], "issue"), 0),
                "unread_count": unread.get(conversation["id"], 0),
                "last_message": last and {
                    "sender_name": last["sender_name"], "is_me": bool(last["is_me"]),
                    "text": content.summary(conversation["source"], last["raw"], last["text"]),
                    "sent_at": last["sent_at"]},
            })
        projects.append({**project(row), "groups": groups,
                         "awaiting_count": sum(g["awaiting_count"] for g in groups)})
    return {"projects": projects}


def quote(store: Store, row) -> dict | None:
    """被回复的那条消息的摘要；本地没存（太早或已清理）时只给出「有回复」。"""
    if not row["reply_to"]:
        return None
    target = store.message_by_remote(row["conversation"], row["reply_to"])
    if not target:
        # 钉钉消息自带被引用消息的内容，本地没存也能显示。
        quoted = (json.loads(row["raw"] or "{}") or {}).get("quotedMessage") or {}
        if quoted.get("text") or quoted.get("sender"):
            return {"found": True, "id": None, "sender_name": quoted.get("sender") or "",
                    "is_me": False, "text": content.summary("dingtalk", quoted, quoted.get("text") or "")}
        return {"found": False}
    return {"found": True, "id": target["id"], "sender_name": target["sender_name"],
            "is_me": bool(target["is_me"]),
            "text": content.summary(target["source"], target["raw"], target["text"])}


def message(row, reason: str | None, handled: bool = False, quote: dict | None = None) -> dict:
    raw = json.loads(row["raw"] or "{}")
    if actions.is_retracted(row):
        return {**_message_head(row), "text": "", "attachments": [], "attention": None,
                "handled": handled, "quote": None, "retracted": True, "edited": False, "ai": False}
    text, attachments = content.parse(row["source"], raw, row["text"])
    return {
        **_message_head(row), "text": text, "attachments": [a.public() for a in attachments],
        "attention": reason, "handled": handled, "quote": quote, "retracted": False,
        "edited": bool(row["edited_at"] or raw.get("edited_at")),
        "ai": bool(row["ai_sent"]),
    }


def messages(store: Store, rows, reasons: dict[int, str] | None = None) -> list[dict]:
    """一组消息：带处理状态、引用摘要和挂着的任务。"""
    handled = store.handled_ids([r["id"] for r in rows])
    return with_tasks(store, [message(r, (reasons or {}).get(r["id"]), r["id"] in handled, quote(store, r))
                              for r in rows])


def with_tasks(store: Store, items: list[dict]) -> list[dict]:
    links = store.task_links([m["id"] for m in items])
    for item in items:
        item["tasks"] = [{"id": t["id"], "title": t["title"], "status": t["status"]}
                         for t in links.get(item["id"], [])]
    return items


def _message_head(row) -> dict:
    return {
        "id": row["id"], "group_id": row["conversation"], "group_name": row["conversation_name"],
        "source": row["source"], "sender_name": row["sender_name"], "is_me": bool(row["is_me"]),
        "sent_at": row["sent_at"], "reply_to": row["reply_to"], "remote_id": row["remote_id"],
    }
