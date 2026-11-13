"""把各平台的原始消息整理成统一的「文字 + 附件」。"""

import json
import re
from dataclasses import asdict, dataclass, field

KINDS = ("image", "voice", "video", "file")

# 钉钉把附件写成文字占位：[图片消息](mediaId=…)
_DING_PLACEHOLDER = re.compile(r"\[([^\]\n]{1,12})\]\((?:mediaId|fileId|dentryId)=[^)\s]*\)")
_DING_LABELS = {"图片消息": "image", "语音消息": "voice", "视频消息": "video", "文件消息": "file"}
_DING_CONTENT_TYPES = {"image": "image", "audio": "voice", "video": "video", "file": "file"}


@dataclass
class Attachment:
    kind: str
    name: str = ""
    mime: str = ""
    size: int | None = None
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    transcript: str | None = None
    transcribing: bool = False
    ref: dict = field(default_factory=dict)

    def public(self) -> dict:
        data = asdict(self)
        data.pop("ref")
        return data


def parse(source: str, raw: dict | str, text: str) -> tuple[str, list[Attachment]]:
    """返回去掉附件占位后的文字，以及附件列表。"""
    if isinstance(raw, str):
        raw = json.loads(raw) if raw else {}
    if source == "dingtalk":
        return _dingtalk(raw, text)
    if source == "channel":
        return _channel(raw, text)
    return text, []


_LABELS = {"image": "[图片]", "voice": "[语音]", "video": "[视频]", "file": "[文件]"}


def summary(source: str, raw: dict | str, text: str) -> str:
    """一行摘要：文字，加上附件的类型标签和语音转写。"""
    clean, attachments = parse(source, raw, text)
    parts = [" ".join(clean.split())]
    parts += [_LABELS[a.kind] + (f" {a.transcript}" if a.transcript else "") for a in attachments]
    return " ".join(p for p in parts if p)


def _dingtalk(raw: dict, text: str) -> tuple[str, list[Attachment]]:
    labels = [_DING_LABELS.get(m[1], "file") for m in _DING_PLACEHOLDER.finditer(text)]
    clean = _DING_PLACEHOLDER.sub("", text).strip()
    refs = [r for r in raw.get("resourceRefs") or [] if isinstance(r, dict)]
    # 同一张图会给两份引用（一份不带类型），有带类型的就只用带类型的。
    typed = [r for r in refs if r.get("contentType")]
    attachments = []
    for index, ref in enumerate(typed or refs):
        kind = _DING_CONTENT_TYPES.get(ref.get("contentType", ""))
        if not kind:
            kind = labels[index] if index < len(labels) else "file"
        attachments.append(Attachment(kind=kind, ref=dict(ref.get("download", {}).get("arguments", {}))))
    voice = next((a for a in attachments if a.kind == "voice"), None)
    if voice and clean:
        # 钉钉语音消息的文字部分是它的语音识别结果。
        voice.transcript, clean = clean, ""
    return clean, attachments


def _channel(raw: dict, text: str) -> tuple[str, list[Attachment]]:
    blocks = {b.get("file_id"): b for b in raw.get("blocks") or []
              if isinstance(b, dict) and b.get("type") == "voice"}
    attachments = []
    for file in raw.get("files") or []:
        if not isinstance(file, dict) or not file.get("id"):
            continue
        mime = file.get("mime_type") or ""
        kind = ("image" if mime.startswith("image/") else "voice" if mime.startswith("audio/")
                else "video" if mime.startswith("video/") else "file")
        attachment = Attachment(
            kind=kind, name=file.get("filename") or "", mime=mime, size=file.get("file_size"),
            width=file.get("width"), height=file.get("height"),
            ref={"channel_id": file.get("channel_id") or raw.get("channel_id"), "file_id": file["id"],
                 "name": file.get("filename") or ""},
        )
        block = blocks.get(file["id"])
        if block:
            attachment.kind = "voice"
            attachment.duration_ms = block.get("duration_ms")
            attachment.transcript = block.get("transcript") or None
            attachment.transcribing = block.get("transcription_status") in ("pending", "processing")
        attachments.append(attachment)
    return text.strip(), attachments

