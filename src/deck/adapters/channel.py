from datetime import datetime, timezone

from ..runner import Runner, ToolError, run_json
from .base import Conversation, Message

_PAGE = 50
_MAX_PAGES = 20


class ChannelAdapter:
    """内部 channel，包装 drlee。cursor 是频道里的消息序号。"""

    source = "channel"

    def __init__(self, drlee: str, run: Runner = run_json):
        self._drlee = drlee
        self._run = run

    def resolve(self, query: str) -> Conversation:
        data = self._run([self._drlee, "--json", "channel", "list"])
        hits = [
            channel
            for channel in _items(data["data"])
            if query in (channel.get("id"), channel.get("name"))
        ]
        if len(hits) != 1:
            raise ToolError(f"channel 里没有唯一叫「{query}」的频道（找到 {len(hits)} 个）")
        return Conversation(self.source, hits[0]["id"], hits[0].get("name", ""))

    def fetch(
        self, conversation: str, cursor: str | None
    ) -> tuple[list[Message], str | None]:
        messages: list[Message] = []
        after = cursor
        for _ in range(_MAX_PAGES):
            argv = [self._drlee, "--json", "channel", "messages", "list", conversation]
            argv += ["--limit", str(_PAGE)]
            if after:
                argv += ["--after-sequence", after]
            page = _items(self._run(argv)["data"])
            messages += [self._message(conversation, item) for item in page]
            if page:
                after = str(max(item["message_sequence"] for item in page))
            # 没有 cursor 时只读最近一页；有 cursor 时读到不满一页为止。
            if cursor is None or len(page) < _PAGE:
                break
        return messages, after

    def send(self, conversation: str, text: str, reply_to: str | None = None) -> None:
        argv = [self._drlee, "--json", "channel", "messages", "send", conversation]
        argv += ["--text", text]
        if reply_to:
            argv += ["--reply-to", reply_to]
        self._run(argv)

    def self_ids(self, conversation: str) -> set[str]:
        profile = self._run([self._drlee, "--json", "profile", "show"])["data"]
        return {profile["id"]}

    def _message(self, conversation: str, item: dict) -> Message:
        return Message(
            source=self.source,
            remote_id=item["id"],
            conversation=conversation,
            sender_id=item.get("sender_user_id") or "",
            sender_name=item.get("sender_name") or "",
            text=item.get("text") or "",
            sent_at=datetime.fromisoformat(item["created_at"]).astimezone(timezone.utc),
            reply_to=item.get("thread_root_id"),
            raw=item,
        )


def _items(data: object) -> list[dict]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("items") or next(
            (value for value in data.values() if isinstance(value, list)), []
        )
    return []
