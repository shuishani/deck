import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from ..runner import Runner, ToolError, run_json
from .base import ChatState, Conversation, Message, parse_time

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
            raise ToolError(f"钉钉中未找到唯一名为「{query}」的群（匹配 {len(hits)} 个）")
        group = hits[0]
        return Conversation(self.source, group["conversationId"], group.get("name", ""))

    def chats(self, mine: set[str]) -> list[ChatState]:
        # 只按 p2p 过滤会漏掉第一页之后的单聊，所以连群一起取全再筛。
        data = self._run([self._dws, "chat", "+chat-list", "--types", "group,p2p", "--page-all",
                          "--page-limit", "20", "-f", "json"])
        result = []
        for chat in data.get("chats", []):
            last = parse_time(chat.get("lastMsgCreateAt"))
            unread = chat.get("unreadPoint") or 0
            result.append(ChatState(Conversation(self.source, chat["openConversationId"], chat.get("name", "")),
                                    chat.get("conversationType") == "direct", last,
                                    read_until=None if unread else last, unread=unread))
        return result

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
        messages = [self._message(conversation, item) for item in data.get("messages", [])]
        times = [item["createTime"] for item in data.get("messages", [])]
        return messages, max(times + ([cursor] if cursor else []), default=cursor)

    def send(self, conversation: str, text: str, reply_to: str | None = None,
             ai: bool = False) -> None:
        # dws 默认给消息加「通过 AI 发送」角标，只有以 AI 身份发时才保留。
        tag = f"--ai-tag={'true' if ai else 'false'}"
        if reply_to:
            argv = [self._dws, "chat", "+messages-reply", "--group", conversation,
                    "--message-id", reply_to]
        else:
            argv = [self._dws, "chat", "+send-to-group", "--group", conversation]
        self._run(argv + ["--content", text, tag, "--yes", "-f", "json"])

    def send_attachments(self, conversation: str, text: str, reply_to: str | None,
                         ai: bool, items: list[dict]) -> None:
        if len(items) != 1:
            raise ValueError("钉钉每次只能发送 1 个附件")
        if reply_to:
            # +messages-reply 只支持纯文本引用，附件不能带引用。
            raise ValueError("钉钉不支持带附件的引用回复")
        item = items[0]
        tag = f"--ai-tag={'true' if ai else 'false'}"
        suffix = Path(item["path"]).suffix.lower()
        # dws 只认工作目录内的相对路径：复制到临时目录里，用不含用户文件名的安全名字。
        work = Path(tempfile.mkdtemp(prefix=".send-"))
        try:
            local = f"upload{suffix}" if item.get("kind") == "image" else Path(item["name"]).name
            shutil.copyfile(item["path"], work / local)
            (work / local).chmod(0o600)
            base = [self._dws, "chat", "+messages-send", "--as", "user", "--group", conversation]
            if item.get("kind") == "image":
                # 图片用 Markdown 内联本地图片，文字和图片同一条消息。
                caption = re.sub(r"([\\`*_{}\[\]()#+.!<>])", r"\\\1", text)
                body = (f"{caption}\n\n" if caption else "") + f"![image](./{local})"
                self._run(base + ["--markdown", body, tag, "--yes", "-f", "json"], cwd=str(work))
                return
            if text:
                # 文件消息不能同时带文字：先发文字，再发文件。
                self.send(conversation, text, None, ai)
            try:
                self._run(base + ["--msg-type", "file", "--file", f"./{local}", tag, "--yes", "-f", "json"],
                          cwd=str(work))
            except ToolError as error:
                if text:
                    raise ToolError(f"文字已发送，但文件发送失败：{error}") from error
                raise
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def self_ids(self, conversation: str) -> set[str]:
        status = self._run([self._dws, "auth", "status", "-f", "json"])
        user_id = status.get("user_id")
        if not user_id:
            raise ToolError("dws 未登录，请先运行 dws auth login")
        # 消息里的发送人 id 和 userId 不是一套，按 userId 过滤读一条反查出来。
        mine = self._run(
            [self._dws, "chat", "+chat-messages", "--group", conversation]
            + ["--sender", str(user_id), "--limit", "1", "-f", "json"]
        )
        return {str(user_id)} | {
            item["senderId"] for item in mine.get("messages", []) if item.get("senderId")
        }


    def edit(self, conversation: str, raw: dict, text: str) -> None:
        self._run([self._dws, "chat", "message", "edit", "--conversation-id", conversation,
                   "--message-id", raw["messageId"], "--text", text, "-f", "json"])

    def retract(self, conversation: str, raw: dict) -> None:
        self._run([self._dws, "chat", "message", "recall", "--conversation-id", conversation,
                   "--message-id", raw["messageId"], "-f", "json"])

    def refetch(self, conversation: str, raw: dict) -> Message | None:
        data = self._run([self._dws, "chat", "+messages-mget", "--msg-ids", raw["messageId"],
                          "--no-reactions", "--no-threads", "-f", "json"])
        items = [self._message(conversation, item) for item in data.get("messages", [])]
        return items[0] if items else None

    def download(self, ref: dict, stem: Path) -> Path:
        # dws 只肯写到工作目录里的相对路径：在临时目录里下载，再挪到缓存位置。
        work = Path(tempfile.mkdtemp(prefix=".download-", dir=stem.parent))
        try:
            self._run(
                [self._dws, "chat", "+messages-resource-download",
                 "--resource-id", ref["resource-id"], "--message-id", ref["message-id"],
                 "--open-conversation-id", ref["open-conversation-id"],
                 "--type", ref.get("type") or "mediaId", "--output", ".", "-f", "json"],
                cwd=str(work),
            )
            files = [file for file in work.iterdir() if file.is_file()]
            if len(files) != 1:
                raise ToolError("钉钉附件下载结果异常")
            final = stem.with_suffix(files[0].suffix.lower())
            os.replace(files[0], final)
            return final
        except KeyError as error:
            raise ToolError("钉钉附件缺少下载参数") from error
        finally:
            shutil.rmtree(work, ignore_errors=True)


    def _message(self, conversation: str, item: dict) -> Message:
        return Message(
            source=self.source,
            remote_id=item["messageId"],
            conversation=conversation,
            sender_id=item.get("senderId", ""),
            sender_name=item.get("sender", ""),
            text=item.get("text", ""),
            sent_at=_local_to_utc(item["createTime"]),
            reply_to=(item.get("quotedMessage") or {}).get("messageId"),
            raw=item,
            bot=bool(item.get("messageAiSendFlag")),
        )


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
