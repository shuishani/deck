from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
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
    # AI 或机器人发的（含拍档代真人自动发的）：@人不算有人找我，我的拍档自动回的也不算我回过。
    bot: bool = False


@dataclass(frozen=True)
class ChatState:
    """平台会话列表里的一项：是不是单聊、最后一条的时间、我在平台上读到哪里（或还有几条未读）。"""
    conversation: Conversation
    direct: bool
    last_at: datetime | None
    read_until: datetime | None = None
    unread: int | None = None


def parse_time(text: str | None) -> datetime | None:
    """平台给的带时区 ISO 时间；没有或认不出时返回 None。"""
    try:
        return datetime.fromisoformat(text) if text else None
    except ValueError:
        return None


class Adapter(Protocol):
    """一个数据源。新数据源只要实现这几个方法，核心不用改。"""

    source: str

    def resolve(self, query: str) -> Conversation:
        """按名字或原始 id 找到唯一的会话；找不到或不唯一就报错。"""
        ...

    def chats(self, mine: set[str]) -> list[ChatState]:
        """我加入的全部会话（群和单聊）及各自的已读状态；mine 是我的发送人 id。"""
        ...

    def fetch(
        self, conversation: str, cursor: str | None
    ) -> tuple[list[Message], str | None]:
        """读 cursor 之后的消息（cursor 为 None 时读最近一页），返回消息和新 cursor。"""
        ...

    def send(self, conversation: str, text: str, reply_to: str | None = None,
             ai: bool = False) -> None:
        """发到群里；reply_to 是被回复消息的原始 id，ai 表示以 AI 身份发送。"""
        ...

    def send_attachments(self, conversation: str, text: str, reply_to: str | None,
                         ai: bool, items: list[dict]) -> None:
        """带附件发送；items 含本机 path/name/kind。平台做不到的组合报 ValueError，不降级。"""
        ...

    def self_ids(self, conversation: str) -> set[str]:
        """我在这个数据源里的发送人 id，用来标出哪些是我发的。"""
        ...

    def edit(self, conversation: str, raw: dict, text: str) -> None:
        """修改我发的一条消息；raw 是这条消息的原始数据。"""
        ...

    def retract(self, conversation: str, raw: dict) -> None:
        """撤回我发的一条消息，群里所有人都看不到。"""
        ...

    def refetch(self, conversation: str, raw: dict) -> Message | None:
        """重读一条消息，拿到编辑后的内容；读不到返回 None。"""
        ...

    def download(self, ref: dict, stem: Path) -> Path:
        """把附件下载到 stem 加上原扩展名的位置，返回最终路径。"""
        ...
