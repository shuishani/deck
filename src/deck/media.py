"""附件：第一次查看时经平台 CLI 下载到 ~/.deck/media，之后直接读缓存。"""

import mimetypes
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from . import content
from .adapters import Adapter
from .store import Store

# 只有这些类型直接在页面里显示或播放；其余一律作为下载，避免被当成网页执行。
_INLINE = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/wav", "audio/webm",
    "video/mp4", "video/webm",
}


@dataclass(frozen=True)
class Media:
    path: Path
    mime: str
    name: str
    inline: bool


def get(store: Store, adapter_for: Callable[[str], Adapter], message_id: int, index: int) -> Media:
    row = store.message(message_id)
    if not row:
        raise LookupError("消息不存在")
    _, attachments = content.parse(row["source"], row["raw"], row["text"])
    if not 0 <= index < len(attachments):
        raise LookupError("附件不存在")
    attachment = attachments[index]
    store.media_dir.mkdir(mode=0o700, exist_ok=True)
    stem = store.media_dir / f"{message_id}-{index}"
    path = next(iter(sorted(store.media_dir.glob(f"{stem.name}.*"))), None)
    if path is None:
        path = stem if stem.is_file() else adapter_for(row["source"]).download(attachment.ref, stem)
    mime = sniff(path)
    name = attachment.name or f"{attachment.kind}-{message_id}{path.suffix}"
    return Media(path, mime, name, mime in _INLINE)


def sniff(path: Path) -> str:
    with path.open("rb") as file:
        head = file.read(16)
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head.startswith(b"GIF8"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"OggS"):
        return "audio/ogg"
    if head[4:8] == b"ftyp":
        return "audio/mp4" if path.suffix in (".m4a", ".aac") else "video/mp4"
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"
