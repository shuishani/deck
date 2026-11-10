from collections.abc import Callable
from dataclasses import dataclass
from sqlite3 import Row

from .adapters import Adapter
from .store import Store

AdapterFor = Callable[[str], Adapter]


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
) -> list[SyncResult]:
    """把监测的群从上次读到的地方往后读一遍，新消息入库。一个群失败不影响其他群。"""
    rows = store.conversations(project)
    if conversation is not None:
        rows = [row for row in rows if row["id"] == conversation]
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
        except Exception as error:  # noqa: BLE001 - 每个群单独报错，继续下一个
            result.error = str(error)
        store.set_sync_status(row["id"], result.error)
        results.append(result)
    return results
