import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from sqlite3 import Row

from .adapters import Adapter
from .adapters.base import ChatState
from .store import PERSONAL, Store

AdapterFor = Callable[[str], Adapter]

# 语音转写一般几秒完成；超过这个时间还没好就不再等。
_TRANSCRIBE_WINDOW = timedelta(hours=2)


@dataclass
class SyncResult:
    conversation: Row
    added: int = 0
    error: str | None = None


def sync(
    store: Store,
    adapter_for: AdapterFor,
    project: str | None = None,
    conversation: int | None = None,
    source: str | None = None,
) -> list[SyncResult]:
    """把监测的群从上次读到的地方往后读一遍，新消息入库。一个群失败不影响其他群。"""
    rows = store.conversations(project)
    if conversation is not None:
        rows = [row for row in rows if row["id"] == conversation]
    else:
        paused = store.paused_sources()
        rows = [row for row in rows if row["source"] not in paused and row["mode"] != "off"
                and source in (None, row["source"])]
    results = []
    for row in rows:
        result = SyncResult(row)
        try:
            adapter = adapter_for(row["source"])
            mine = store.self_ids(row["source"])
            if mine is None or row["cursor"] is None:
                mine = store.add_self_ids(row["source"], adapter.self_ids(row["remote_id"]))
            messages, cursor = adapter.fetch(row["remote_id"], row["cursor"])
            result.added = store.add_messages(row["id"], messages, mine)
            store.set_cursor(row["id"], cursor)
            recent = getattr(adapter, "recent", None)
            if recent:
                store.refresh(row["id"], recent(row["remote_id"]))
            _refresh_transcripts(store, adapter, row)
        except Exception as error:  # noqa: BLE001 - 每个群单独报错，继续下一个
            result.error = str(error)
        store.set_sync_status(row["id"], result.error)
        results.append(result)
    return results


def refresh_chats(store: Store, adapter: Adapter) -> list[int]:
    """按平台的会话列表更新：每个会话在平台上读到哪里、新出现的单聊（只监听）、单聊改名。
    返回有新消息、需要同步的单聊。"""
    known = {row["remote_id"]: row for row in store.conversations() if row["source"] == adapter.source}
    due = []
    for state in adapter.chats(store.self_ids(adapter.source) or set()):
        row = known.get(state.conversation.remote_id)
        if row is not None:
            _mark_seen(store, row["id"], state)
        if not state.direct:
            continue
        if row is None:
            id = _add_direct(store, state)
            if id is not None:
                due.append(id)
            continue
        if state.conversation.name and state.conversation.name != row["name"]:
            store.rename_conversation(row["id"], state.conversation.name)
        if row["mode"] != "off" and _newer(state.last_at, row["last_sync_at"]):
            due.append(row["id"])
    return due


def _mark_seen(store: Store, id: int, state: ChatState) -> None:
    seen = state.read_until or (store.read_before_unread(id, state.unread) if state.unread else None)
    if seen:
        store.set_seen(id, seen)


def _add_direct(store: Store, state: ChatState) -> int | None:
    """移除过的单聊像聊天软件里删掉的对话：对方再发新消息才重新出现。"""
    source, remote_id = state.conversation.source, state.conversation.remote_id
    removed = store.removed_at(source, remote_id)
    if removed is not None:
        if state.last_at is None or state.last_at <= removed:
            return None
        store.forget_removed(source, remote_id)
    return store.add_conversation(PERSONAL, state.conversation, chat="direct", mode="listen")


def _newer(at: datetime | None, than: str | None) -> bool:
    """at 比 than 晚；任一个不知道时当作有新内容。"""
    return at is None or than is None or at > datetime.fromisoformat(than)


def _refresh_transcripts(store: Store, adapter: Adapter, conversation: Row) -> None:
    refetch = getattr(adapter, "refetch", None)
    if not refetch:
        return
    since = datetime.now(timezone.utc) - _TRANSCRIBE_WINDOW
    for message in store.transcribing(conversation["id"], since):
        fresh = refetch(conversation["remote_id"], json.loads(message["raw"]))
        if fresh:
            store.update_message(message["id"], fresh.text, fresh.raw)
