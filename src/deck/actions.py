from collections.abc import Callable
from sqlite3 import Row

from .adapters import Adapter
from .config import Config
from .runner import ToolError
from .store import Store
from .sync import sync

AdapterFor = Callable[[str], Adapter]


def add_project(store: Store, key: str, name: str, repo: str | None) -> None:
    if not key.strip() or not name.strip():
        raise ValueError("项目简称和名称都不能为空")
    store.add_project(key.strip(), name.strip(), repo or None)
    store.audit("me", "project.add", key, {"name": name, "repo": repo}, "ok")


def add_group(store: Store, adapter_for: AdapterFor, project: str, source: str, query: str) -> Row:
    if not store.project(project):
        raise ValueError(f"没有项目 {project}，先登记项目")
    conversation = adapter_for(source).resolve(query.strip())
    id = store.add_conversation(project, conversation)
    store.audit("me", "group.add", f"{conversation.source}:{conversation.remote_id}",
                {"project": project, "name": conversation.name}, "ok")
    return store.conversation(id)


def remove_group(store: Store, id: int) -> Row:
    row = store.conversation(id)
    if not row or not store.remove_conversation(id):
        raise ValueError(f"没有编号 {id} 的群")
    store.audit("me", "group.remove", f"{row['source']}:{row['remote_id']}",
                {"name": row["name"]}, "ok")
    return row


def plan_send(store: Store, config: Config, group: int, text: str,
              reply_to: str | None, ai: bool) -> tuple[Row, dict]:
    row = store.conversation(group)
    if not row:
        raise ValueError(f"没有编号 {group} 的群")
    if not text.strip():
        raise ValueError("消息不能为空")
    final = f"{config.ai_prefix}{text}" if ai else text
    return row, {"group": row["name"], "source": row["source"], "text": final,
                 "reply_to": reply_to}


def send(store: Store, config: Config, adapter_for: AdapterFor, group: int, text: str,
         reply_to: str | None, ai: bool) -> None:
    """真的发出去：记审计，然后回读一次让它进时间线。"""
    row, plan = plan_send(store, config, group, text, reply_to, ai)
    actor = "ai" if ai else "me"
    target = f"{row['source']}:{row['remote_id']}"
    try:
        adapter_for(row["source"]).send(row["remote_id"], plan["text"], reply_to)
    except ToolError as error:
        store.audit(actor, "message.send", target, plan, f"error: {error}")
        raise
    store.audit(actor, "message.send", target, plan, "ok")
    sync(store, adapter_for, conversation=row["id"])
