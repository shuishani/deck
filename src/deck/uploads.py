"""待发送附件：本机暂存、校验、绑定用户和群，最终确认时才通过平台 CLI 发出。

暂存文件不会自动删除或过期。
"""
import os
import re
import sqlite3
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path

MAX_BYTES = 10 * 1024 * 1024
MAX_FILES = 1

_IMAGES = {
    ".png": ("image/png", (b"\x89PNG\r\n\x1a\n",)),
    ".jpg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".jpeg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".gif": ("image/gif", (b"GIF87a", b"GIF89a")),
    ".webp": ("image/webp", (b"RIFF",)),
}
_ZIP = (b"PK\x03\x04",)
_FILES = {
    ".pdf": ("application/pdf", (b"%PDF-",)),
    ".zip": ("application/zip", _ZIP),
    ".docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", _ZIP),
    ".xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", _ZIP),
    ".pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", _ZIP),
    ".txt": ("text/plain", None),
    ".md": ("text/markdown", None),
    ".csv": ("text/csv", None),
    ".json": ("application/json", None),
    ".log": ("text/plain", None),
}

_CAPABILITIES = {
    "channel": dict(send_text=True, send_images=True, send_files=True, reply=True,
                    reply_attachments=True, edit=True, retract=True),
    # dws 的引用回复只支持纯文本；文件消息不能同时带文字（先文字后文件两条）。
    "dingtalk": dict(send_text=True, send_images=True, send_files=True, reply=True,
                     reply_attachments=False, edit=True, retract=True),
}
_NONE = dict(send_text=False, send_images=False, send_files=False, reply=False,
             reply_attachments=False, edit=False, retract=False)

def capabilities(source: str) -> dict:
    caps = dict(_CAPABILITIES.get(source, _NONE))
    known = source in _CAPABILITIES
    caps["max_attachment_bytes"] = MAX_BYTES if known else 0
    caps["max_files"] = MAX_FILES if known else 0
    return caps


def _clean_name(name: str) -> str:
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(c for c in unicodedata.normalize("NFC", name) if unicodedata.category(c)[0] != "C")
    name = re.sub(r"\s+", " ", name).strip(" .")
    if len(name) > 120:
        stem, dot, ext = name.rpartition(".")
        name = stem[: 120 - len(ext) - 1] + dot + ext if dot else name[:120]
    return name


def _validate(name: str, data: bytes) -> tuple[str, str, str]:
    name = _clean_name(name)
    suffix = Path(name).suffix.lower()
    if not name or not suffix:
        raise ValueError("文件名需要带扩展名")
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise ValueError("文件为空")
    if len(data) > MAX_BYTES:
        raise ValueError(f"文件超过 {MAX_BYTES // 1024 // 1024} MiB 上限")
    kind, table = ("image", _IMAGES) if suffix in _IMAGES else ("file", _FILES)
    if suffix not in table:
        raise ValueError(f"不支持的文件类型 {suffix}")
    mime, magic = table[suffix]
    if magic is not None:
        if not data.startswith(magic) or (suffix == ".webp" and data[8:12] != b"WEBP"):
            raise ValueError("文件内容与扩展名不符")
    elif b"\x00" in data[:8192]:
        raise ValueError("文件内容与扩展名不符")
    return name, mime, kind


def create(store, config, owner: str, group: int, name: str, data: bytes) -> dict:
    """校验并暂存一个附件，只在本机，不上传到平台。返回公开字段。"""
    name, mime, kind = _validate(name, data)
    id = str(uuid.uuid4())
    root = Path(config.home) / "uploads"
    folder = root / id
    root.mkdir(mode=0o700, exist_ok=True)
    os.chmod(root, 0o700)
    folder.mkdir(mode=0o700)
    path = folder / f"file{Path(name).suffix.lower()}"
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        store.db.execute(
            "INSERT INTO upload (id, owner, conv_group, name, size, mime, kind, path, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (id, owner, group, name, len(data), mime, kind, str(path),
             datetime.now(timezone.utc).isoformat()))
        store.db.commit()
    except Exception:
        path.unlink(missing_ok=True)
        folder.rmdir()
        raise
    store.audit("me", "upload.add", id, {"group": group, "name": name, "size": len(data)}, "ok")
    return {"id": id, "name": name, "size": len(data), "mime": mime, "kind": kind}


def get(store, owner: str, id: str) -> dict | None:
    """按所有者取内部元数据（含 path），登录后预览/下载用；不属于该用户返回 None。"""
    row = store.db.execute("SELECT * FROM upload WHERE id = ? AND owner = ?", (id, owner)).fetchone()
    return _row(row) if row else None


def _row(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "name": row["name"], "size": row["size"], "mime": row["mime"],
            "kind": row["kind"], "path": row["path"], "group": row["conv_group"]}


def prepare(store, owner: str, group: int, ids: list[str]) -> list[dict]:
    """取出要发送的附件（含内部 path）。所有者、群、数量、文件完整性任一不符都拒绝。"""
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        raise ValueError("附件参数无效")
    if len(set(ids)) != len(ids):
        raise ValueError("附件重复")
    if len(ids) > MAX_FILES:
        raise ValueError(f"每次最多发送 {MAX_FILES} 个附件")
    items = []
    for id in ids:
        item = get(store, owner, id)
        if item is None or item["group"] != group:
            raise ValueError("附件不存在或不属于当前用户和群")
        try:
            size = os.stat(item["path"]).st_size
        except OSError as error:
            raise ValueError("附件文件已丢失，请重新上传") from error
        if size != item["size"]:
            raise ValueError("附件文件已变化，请重新上传")
        items.append(item)
    return items


def public(items: list[dict]) -> list[dict]:
    return [{key: item[key] for key in ("id", "name", "size", "mime", "kind")} for item in items]


def send(adapter, conversation: str, text: str, reply_to: str | None, ai: bool,
         items: list[dict]) -> None:
    """最终发送：无附件走普通发送；有附件则校验平台能力，不支持就报错，不降级成只发文字。"""
    if not items:
        adapter.send(conversation, text, reply_to, ai)
        return
    caps = capabilities(adapter.source)
    if len(items) > caps["max_files"]:
        raise ValueError(f"{adapter.source} 每次最多发送 {caps['max_files']} 个附件")
    for item in items:
        if not caps["send_images" if item["kind"] == "image" else "send_files"]:
            raise ValueError(f"{adapter.source} 不支持发送这类附件")
        if item["size"] > caps["max_attachment_bytes"]:
            raise ValueError("附件超过大小上限")
    if reply_to and not caps["reply_attachments"]:
        raise ValueError(f"{adapter.source} 不支持带附件的引用回复")
    if not hasattr(adapter, "send_attachments"):
        raise ValueError(f"{adapter.source} 不支持发送附件")
    adapter.send_attachments(conversation, text, reply_to, ai, items)
