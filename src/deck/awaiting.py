from dataclasses import dataclass
from datetime import datetime, timezone
from sqlite3 import Row

from .config import Config
from .store import Store


@dataclass(frozen=True)
class Awaiting:
    message: Row
    waiting_minutes: int
    overdue: bool


def awaiting(
    store: Store, config: Config, project: str | None = None, now: datetime | None = None
) -> list[Awaiting]:
    """@我、之后我在那个群里还没说过话的消息；忽略 ignore_senders 里的发送人。按等得最久的在前。"""
    names = store.my_names()
    if not names:
        return []
    now = now or datetime.now(timezone.utc)
    ignore = set(config.ignore_senders)
    result = []
    for row in store.unanswered(project):
        if row["sender_name"] in ignore:
            continue
        if not any(f"@{name}" in row["text"] for name in names):
            continue
        minutes = int((now - datetime.fromisoformat(row["sent_at"])).total_seconds() // 60)
        result.append(Awaiting(row, minutes, minutes >= config.reply_reminder_hours * 60))
    return result
