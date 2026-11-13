import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..runner import Runner, ToolError, run_json
from .base import ChatState, Conversation, Message, parse_time

_PAGE = 50
_MAX_PAGES = 20


class ChannelAdapter:
    """内部 channel，包装 drlee。cursor 是频道里的消息序号。"""

    source = "channel"

    def __init__(self, drlee: str, run: Runner = run_json, sender: str | None = None):
        self._drlee = drlee
        # 平时发消息可以单独指定一个 drlee：新版会被 channel 标成「拍档 / AI 代发」，
        # 以 AI 身份发时仍用新版，让这个标记只出现在 AI 发的消息上。
        self._sender = sender or drlee
        self._run = run

    def resolve(self, query: str) -> Conversation:
        data = self._run([self._drlee, "--json", "channel", "list"])
        hits = [
            channel
            for channel in _items(data["data"])
            if query in (channel.get("id"), channel.get("name"))
        ]
        if len(hits) != 1:
            raise ToolError(f"channel 中未找到唯一名为「{query}」的频道（匹配 {len(hits)} 个）")
        return Conversation(self.source, hits[0]["id"], hits[0].get("name", ""))

    def chats(self, mine: set[str]) -> list[ChatState]:
        data = self._run([self._drlee, "--json", "channel", "list"])
        result = []
        for channel in _items(data["data"]):
            direct = channel.get("type") == "dm"
            name = channel.get("name", "")
            if direct:
                # 私信的 name 是内部编号，用对方的名字。
                others = [m.get("display_name", "") for m in channel.get("member_previews") or [] if m.get("id") not in mine]
                name = "、".join(n for n in others if n) or name
            result.append(ChatState(Conversation(self.source, channel["id"], name), direct,
                                    parse_time(channel.get("last_message_created_at")),
                                    read_until=parse_time(channel.get("last_read_message_created_at"))))
        return result

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

    def send(self, conversation: str, text: str, reply_to: str | None = None,
             ai: bool = False) -> None:
        argv = [self._drlee if ai else self._sender, "--json", "channel", "messages", "send", conversation]
        argv += ["--text", text]
        if reply_to:
            argv += ["--reply-to", reply_to]
        self._run(argv)

    def send_attachments(self, conversation: str, text: str, reply_to: str | None,
                         ai: bool, items: list[dict]) -> None:
        if len(items) != 1:
            raise ValueError("channel 每次只能发送 1 个附件")
        # drlee 的 --attach 会先上传本地文件再发消息，一次调用完成。
        argv = [self._drlee if ai else self._sender, "--json", "channel", "messages", "send", conversation]
        if text:
            argv += ["--text", text]
        if reply_to:
            argv += ["--reply-to", reply_to]
        with tempfile.TemporaryDirectory(prefix=".deck-attach-") as work:
            name = Path(items[0]["name"]).name
            path = Path(work) / name
            shutil.copyfile(items[0]["path"], path)
            path.chmod(0o600)
            self._run(argv + ["--attach", str(path)], cwd=work)

    def self_ids(self, conversation: str) -> set[str]:
        profile = self._run([self._drlee, "--json", "profile", "show"])["data"]
        return {profile["id"]}

    def download(self, ref: dict, stem: Path) -> Path:
        suffix = Path(ref.get("name") or "").suffix.lower()
        temp = stem.parent / f".download-{uuid.uuid4().hex}{suffix}"
        try:
            self._run([self._drlee, "--json", "channel", "files", "download",
                       "--output", str(temp), ref["channel_id"], ref["file_id"]])
            final = stem.with_suffix(suffix)
            os.replace(temp, final)
            return final
        except KeyError as error:
            raise ToolError("channel 附件缺少下载参数") from error
        finally:
            temp.unlink(missing_ok=True)

    def edit(self, conversation: str, raw: dict, text: str) -> None:
        # 带上当前版本号：别处先改过就会被拒，避免覆盖。
        self._run([self._drlee, "--json", "channel", "messages", "edit", conversation, raw["id"],
                   "--if-revision", str(raw.get("revision") or 1), "--text", text])

    def retract(self, conversation: str, raw: dict) -> None:
        self._run([self._drlee, "--json", "channel", "messages", "delete", conversation, raw["id"],
                   "--confirm"])

    def recent(self, conversation: str) -> list[Message]:
        """最近一页，用来发现在 App 里被编辑、撤回的消息。"""
        page = _items(self._run([self._drlee, "--json", "channel", "messages", "list", conversation,
                                 "--limit", str(_PAGE)])["data"])
        return [self._message(conversation, item) for item in page]

    def refetch(self, conversation: str, raw: dict) -> Message | None:
        """重读一条消息（语音转写完成后内容会更新）。"""
        sequence = raw.get("message_sequence")
        if not isinstance(sequence, int):
            return None
        page = _items(self._run(
            [self._drlee, "--json", "channel", "messages", "list", conversation,
             "--limit", "1", "--after-sequence", str(sequence - 1)])["data"])
        item = next((item for item in page if item.get("id") == raw.get("id")), None)
        return self._message(conversation, item) if item else None

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
            # Dr. Lee 等 agent，以及拍档代真人自动发的（界面上是「用户说」）。
            bot=item.get("sender_kind") == "agent" or any(
                isinstance(b, dict) and b.get("type") == "ai_assisted" and b.get("automatic")
                for b in item.get("blocks") or []),
        )


def _items(data: object) -> list[dict]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("items") or next(
            (value for value in data.values() if isinstance(value, list)), []
        )
    return []
