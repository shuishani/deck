"""哪些消息需要我处理：需回复（@我、回复我）和疑似问题（像在反馈问题）。"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from sqlite3 import Row

from . import content, rules
from .actions import is_retracted
from .config import Config
from .store import Store

# 疑似问题只看最近几天，免得旧消息一直挂着。
ISSUE_DAYS = 3
_ISSUE_WORDS = re.compile(
    r"报错|错误|失败|异常|bug|不行|用不了|无法|没反应|打不开|进不去|白屏|卡住|卡死|崩|闪退|超时"
    r"|问题|怎么|为什么|求助|帮忙看",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Attention:
    message: Row
    reason: str  # "mention" 需回复 / "issue" 疑似问题
    waiting_minutes: int
    overdue: bool


def attention(
    store: Store, config: Config, project: str | None = None, now: datetime | None = None
) -> list[Attention]:
    """别人发的、没标记处理、也没被我引用回复过的消息里，@我或回复我的算需回复，
    像在反馈问题的算疑似问题。忽略 ignore_senders。按时间从旧到新。"""
    now = now or datetime.now(timezone.utc)
    names = store.my_names()
    mine = store.my_remote_ids()
    ignore = set(config.ignore_senders)
    issue_since = now - timedelta(days=ISSUE_DAYS)
    result = []
    for row in store.candidates(project):
        if row["sender_name"] in ignore or row["quoted"] or is_retracted(row):
            continue
        rule = rules.decode(row["rules"])
        if rules.quiet(rule, now):
            continue
        sent_at = datetime.fromisoformat(row["sent_at"])
        text = _searchable(row)
        if rule["scope"] == "keywords" and not any(w.casefold() in text.casefold() for w in rule["keywords"]):
            continue
        if any(f"@{name}" in row["text"] for name in names) or (row["reply_to"] or "") in mine:
            reason = "mention"
        elif rule["scope"] == "mentions":
            continue
        elif sent_at >= issue_since and (rule["scope"] == "keywords" or _ISSUE_WORDS.search(text)):
            reason = "issue"
        else:
            continue
        minutes = int((now - sent_at).total_seconds() // 60)
        result.append(Attention(row, reason, minutes,
                                reason == "mention" and minutes >= config.reply_reminder_hours * 60))
    return result


def _searchable(row: Row) -> str:
    text, attachments = content.parse(row["source"], row["raw"], row["text"])
    return " ".join([text, *(a.transcript or "" for a in attachments)])
