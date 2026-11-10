from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class Conversation:
    source: str
    remote_id: str
    name: str


@dataclass(frozen=True)
class Message:
    source: str
    remote_id: str
    conversation: str
    sender_id: str
    sender_name: str
    text: str
    sent_at: datetime
    reply_to: str | None = None
    raw: dict = field(default_factory=dict, compare=False)


class Adapter(Protocol):
    """一个数据源。新数据源只要实现这几个方法，核心不用改。"""

    source: str

    def resolve(self, query: str) -> Conversation:
        """按名字或原始 id 找到唯一的会话；找不到或不唯一就报错。"""
        ...

    def fetch(
        self, conversation: str, cursor: str | None
    ) -> tuple[list[Message], str | None]:
        """读 cursor 之后的消息（cursor 为 None 时读最近一页），返回消息和新 cursor。"""
        ...

    def send(self, conversation: str, text: str, reply_to: str | None = None) -> None: ...

    def self_ids(self, conversation: str) -> set[str]:
        """我在这个数据源里的发送人 id，用来标出哪些是我发的。"""
        ...
