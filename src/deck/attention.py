"""哪些消息需要我处理：需回复（@我、回复我）和疑似问题（像在反馈问题）。"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from sqlite3 import Row

from . import content, notify, rules
from .actions import is_retracted
from .config import Config
from .store import Store

# 疑似问题和单聊只看最近几天，免得旧消息一直挂着（@我 不受限，直到回复或标记处理）。
RECENT_DAYS = 3
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
    """别人发的、平台上还没读、没标记处理、也没被我引用回复过的消息里（AI 发的不算），
    单聊、@我或回复我的算需回复，像在反馈问题的算疑似问题。按时间从旧到新。"""
    now = now or datetime.now(timezone.utc)
    names = store.my_names()
    mine = store.my_remote_ids()
    since = now - timedelta(days=RECENT_DAYS)
    # 超时跟推送级别「高」走：过了它的推送等待时间还没处理就算超时；不推送或立即推送时不标。
    limit = notify.wait(store, "high", now)
    result = []
    for row in store.candidates(project):
        if row["quoted"] or is_retracted(row):
            continue
        rule = rules.decode(row["rules"])
        if rule["scope"] == "off" or rules.quiet(rule, now):
            continue
        sent_at = datetime.fromisoformat(row["sent_at"])
        text = _searchable(row)
        if rule["scope"] == "keywords" and not any(w.casefold() in text.casefold() for w in rule["keywords"]):
            continue
        if row["chat"] == "direct":
            # 单聊本身就是找我；我后来亲自说过话就算回了。
            if row["answered"] or sent_at < since:
                continue
            reason = "mention"
        elif any(f"@{name}" in row["text"] for name in names) or (row["reply_to"] or "") in mine:
            reason = "mention"
        elif rule["scope"] == "mentions":
            continue
        elif sent_at >= since and (rule["scope"] == "keywords" or _ISSUE_WORDS.search(text)):
            reason = "issue"
        else:
            continue
        minutes = int((now - sent_at).total_seconds() // 60)
        result.append(Attention(row, reason, minutes, reason == "mention" and bool(limit) and minutes >= limit))
    return result


def _searchable(row: Row) -> str:
    text, attachments = content.parse(row["source"], row["raw"], row["text"])
    return " ".join([text, *(a.transcript or "" for a in attachments)])
