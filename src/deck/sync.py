import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from sqlite3 import Row

from .adapters import Adapter
from .store import Store

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
        rows = [row for row in rows if row["source"] not in paused and source in (None, row["source"])]
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


def _refresh_transcripts(store: Store, adapter: Adapter, conversation: Row) -> None:
    refetch = getattr(adapter, "refetch", None)
    if not refetch:
        return
    since = datetime.now(timezone.utc) - _TRANSCRIBE_WINDOW
    for message in store.transcribing(conversation["id"], since):
        fresh = refetch(conversation["remote_id"], json.loads(message["raw"]))
        if fresh:
            store.update_message(message["id"], fresh.text, fresh.raw)
