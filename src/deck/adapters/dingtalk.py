from datetime import datetime, timezone

from ..runner import Runner, ToolError, run_json
from .base import Conversation, Message

_PAGE = 50
_MAX_PAGES = 20


class DingTalkAdapter:
    """钉钉，包装官方 dws。消息时间是本地时间字符串，存成 UTC。"""

    source = "dingtalk"

    def __init__(self, dws: str, run: Runner = run_json):
        self._dws = dws
        self._run = run

    def resolve(self, query: str) -> Conversation:
        data = self._run([self._dws, "chat", "+my-groups", "-f", "json"])
        hits = [
            group
            for group in _dicts(data)
            if "conversationId" in group
            and query in (group.get("conversationId"), group.get("name"))
        ]
        if len(hits) != 1:
            raise ToolError(f"钉钉里没有唯一叫「{query}」的群（找到 {len(hits)} 个）")
        group = hits[0]
        return Conversation(self.source, group["conversationId"], group.get("name", ""))

    def fetch(
        self, conversation: str, cursor: str | None
    ) -> tuple[list[Message], str | None]:
        argv = [self._dws, "chat", "+chat-messages", "--group", conversation]
        argv += ["-f", "json"]
        if cursor:
            # --start 含当天这一秒，同一秒的旧消息会再来一次，入库时按 id 去重。
            argv += ["--start", cursor, "--page-all", "--page-limit", str(_PAGE)]
            argv += ["--max-items", str(_PAGE * _MAX_PAGES)]
        else:
            argv += ["--limit", str(_PAGE)]
        data = self._run(argv)
        messages = [
            Message(
                source=self.source,
                remote_id=item["messageId"],
                conversation=conversation,
                sender_id=item.get("senderId", ""),
                sender_name=item.get("sender", ""),
                text=item.get("text", ""),
                sent_at=_local_to_utc(item["createTime"]),
                raw=item,
            )
            for item in data.get("messages", [])
        ]
        times = [item["createTime"] for item in data.get("messages", [])]
        return messages, max(times + ([cursor] if cursor else []), default=cursor)

    def send(self, conversation: str, text: str, reply_to: str | None = None) -> None:
        if reply_to:
            raise ToolError("钉钉的引用回复还没接，先不带 --reply-to 发")
        self._run(
            [self._dws, "chat", "+send-to-group", "--group", conversation]
            + ["--content", text, "--yes", "-f", "json"]
        )

    def self_ids(self, conversation: str) -> set[str]:
        status = self._run([self._dws, "auth", "status", "-f", "json"])
        user_id = status.get("user_id")
        if not user_id:
            raise ToolError("dws 没有登录，先运行 dws auth login")
        # 消息里的发送人 id 和 userId 不是一套，按 userId 过滤读一条反查出来。
        mine = self._run(
            [self._dws, "chat", "+chat-messages", "--group", conversation]
            + ["--sender", str(user_id), "--limit", "1", "-f", "json"]
        )
        return {str(user_id)} | {
            item["senderId"] for item in mine.get("messages", []) if item.get("senderId")
        }


def _local_to_utc(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").astimezone(timezone.utc)


def _dicts(value: object):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _dicts(child)
