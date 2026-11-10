import hashlib
import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .adapters.base import Conversation, Message

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    key        TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    repo       TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
    id           INTEGER PRIMARY KEY,
    project      TEXT NOT NULL REFERENCES projects(key),
    source       TEXT NOT NULL,
    remote_id    TEXT NOT NULL,
    name         TEXT NOT NULL,
    cursor       TEXT,
    added_at     TEXT NOT NULL,
    last_sync_at TEXT,
    last_error   TEXT,
    UNIQUE (source, remote_id)
);
CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY,
    conversation INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    remote_id    TEXT NOT NULL,
    sender_id    TEXT NOT NULL,
    sender_name  TEXT NOT NULL,
    is_me        INTEGER NOT NULL,
    text         TEXT NOT NULL,
    sent_at      TEXT NOT NULL,
    reply_to     TEXT,
    raw          TEXT NOT NULL,
    UNIQUE (conversation, remote_id)
);
CREATE INDEX IF NOT EXISTS messages_by_time ON messages (sent_at);
CREATE TABLE IF NOT EXISTS identities (
    source TEXT PRIMARY KEY,
    ids    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
    id     INTEGER PRIMARY KEY,
    at     TEXT NOT NULL,
    actor  TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT NOT NULL,
    result TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    id           INTEGER PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    user_agent   TEXT NOT NULL,
    ip           TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pairings (
    code_hash  TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT
);
"""

# 旧库缺的列，按需补上。
_ADDED_COLUMNS = {
    "conversations": ("last_sync_at TEXT", "last_error TEXT"),
    "sessions": ("disabled_at TEXT",),
}

_MESSAGE_SELECT = (
    "SELECT m.*, c.project, c.source, c.name AS conversation_name"
    " FROM messages m JOIN conversations c ON c.id = m.conversation"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: Path):
        if not path.exists():
            # 先建好只有本人能读写的空文件，再交给 sqlite。
            os.close(os.open(path, os.O_CREAT | os.O_WRONLY, 0o600))
        # 监听线程、网页、命令行会同时读写：WAL + 等锁。
        self.db = sqlite3.connect(path, timeout=15)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = WAL")
        self.db.executescript(SCHEMA)
        self._migrate()

    def _migrate(self) -> None:
        for table, columns in _ADDED_COLUMNS.items():
            have = {row["name"] for row in self.db.execute(f"PRAGMA table_info({table})")}
            for column in columns:
                if column.split()[0] not in have:
                    try:
                        self.db.execute(f"ALTER TABLE {table} ADD COLUMN {column}")
                    except sqlite3.OperationalError as error:
                        # 另一个连接（监听线程）同时加上了。
                        if "duplicate column" not in str(error):
                            raise
        self.db.commit()

    def close(self) -> None:
        self.db.close()

    def version(self) -> int:
        """数据有变化（新消息、群增删、新操作）就会变的数，给网页判断要不要刷新。"""
        row = self.db.execute(
            "SELECT (SELECT IFNULL(MAX(id), 0) FROM messages),"
            " (SELECT IFNULL(MAX(id), 0) FROM audit),"
            " (SELECT group_concat(id || ':' || IFNULL(last_sync_at, '') || IFNULL(last_error, ''))"
            "  FROM conversations)"
        ).fetchone()
        digest = hashlib.sha1(repr(tuple(row)).encode()).hexdigest()
        return int(digest[:12], 16)

    # --- 项目 ---

    def add_project(self, key: str, name: str, repo: str | None) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO projects (key, name, repo, created_at) VALUES (?, ?, ?, ?)",
                (key, name, repo, _now()),
            )

    def projects(self) -> list[sqlite3.Row]:
        return self.db.execute("SELECT * FROM projects ORDER BY key").fetchall()

    def project(self, key: str) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM projects WHERE key = ?", (key,)).fetchone()

    # --- 会话（监测的群） ---

    def add_conversation(self, project: str, conversation: Conversation) -> int:
        with self.db:
            cursor = self.db.execute(
                "INSERT INTO conversations (project, source, remote_id, name, added_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (project, conversation.source, conversation.remote_id,
                 conversation.name, _now()),
            )
        return int(cursor.lastrowid)

    def conversations(self, project: str | None = None) -> list[sqlite3.Row]:
        if project:
            return self.db.execute(
                "SELECT * FROM conversations WHERE project = ? ORDER BY id", (project,)
            ).fetchall()
        return self.db.execute("SELECT * FROM conversations ORDER BY id").fetchall()

    def conversation(self, id: int) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM conversations WHERE id = ?", (id,)).fetchone()

    def remove_conversation(self, id: int) -> bool:
        with self.db:
            return self.db.execute("DELETE FROM conversations WHERE id = ?", (id,)).rowcount > 0

    def set_cursor(self, id: int, cursor: str | None) -> None:
        with self.db:
            self.db.execute("UPDATE conversations SET cursor = ? WHERE id = ?", (cursor, id))

    def set_sync_status(self, id: int, error: str | None) -> None:
        with self.db:
            self.db.execute(
                "UPDATE conversations SET last_sync_at = ?, last_error = ? WHERE id = ?",
                (_now(), error, id),
            )

    # --- 我是谁 ---

    def self_ids(self, source: str) -> set[str] | None:
        row = self.db.execute("SELECT ids FROM identities WHERE source = ?", (source,)).fetchone()
        return set(json.loads(row["ids"])) if row else None

    def add_self_ids(self, source: str, ids: set[str]) -> set[str]:
        merged = (self.self_ids(source) or set()) | ids
        with self.db:
            self.db.execute(
                "INSERT INTO identities (source, ids) VALUES (?, ?)"
                " ON CONFLICT (source) DO UPDATE SET ids = excluded.ids",
                (source, json.dumps(sorted(merged))),
            )
        return merged

    def my_names(self) -> set[str]:
        rows = self.db.execute(
            "SELECT DISTINCT sender_name FROM messages WHERE is_me = 1 AND sender_name != ''"
        )
        return {row["sender_name"] for row in rows}

    # --- 消息 ---

    def add_messages(self, conversation: int, messages: list[Message], mine: set[str]) -> int:
        """存新消息，已有的跳过；返回新增条数。"""
        before = self.db.total_changes
        with self.db:
            self.db.executemany(
                "INSERT OR IGNORE INTO messages (conversation, remote_id, sender_id,"
                " sender_name, is_me, text, sent_at, reply_to, raw)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (conversation, m.remote_id, m.sender_id, m.sender_name,
                     int(m.sender_id in mine), m.text,
                     m.sent_at.isoformat(timespec="seconds"), m.reply_to,
                     json.dumps(m.raw, ensure_ascii=False))
                    for m in messages
                ],
            )
        return self.db.total_changes - before

    def timeline(
        self,
        project: str | None = None,
        conversation: int | None = None,
        mine: bool = False,
        limit: int = 30,
        before: int | None = None,
    ) -> list[sqlite3.Row]:
        """最近的 limit 条（before 给定时取它之前的），按时间从旧到新。"""
        where, args = [], []
        if project:
            where.append("c.project = ?")
            args.append(project)
        if conversation:
            where.append("c.id = ?")
            args.append(conversation)
        if mine:
            where.append("m.is_me = 1")
        if before:
            where.append(
                "(m.sent_at, m.id) < (SELECT sent_at, id FROM messages WHERE id = ?)"
            )
            args.append(before)
        sql = (
            _MESSAGE_SELECT
            + (" WHERE " + " AND ".join(where) if where else "")
            + " ORDER BY m.sent_at DESC, m.id DESC LIMIT ?"
        )
        rows = self.db.execute(sql, [*args, limit]).fetchall()
        return list(reversed(rows))

    def unanswered(self, project: str | None = None) -> list[sqlite3.Row]:
        """别人发的、之后我在同一个群里还没说过话的消息，按时间从旧到新。"""
        sql = (
            _MESSAGE_SELECT
            + " WHERE m.is_me = 0 AND (? IS NULL OR c.project = ?)"
            " AND NOT EXISTS (SELECT 1 FROM messages r WHERE r.conversation = m.conversation"
            " AND r.is_me = 1 AND r.sent_at > m.sent_at)"
            " ORDER BY m.sent_at, m.id"
        )
        return self.db.execute(sql, (project, project)).fetchall()

    def group_stats(self, since: datetime) -> dict[int, dict]:
        """每个群：since 以来的消息数、最后一条消息。"""
        stats: dict[int, dict] = {}
        for row in self.db.execute(
            "SELECT conversation, COUNT(*) AS n FROM messages WHERE sent_at >= ?"
            " GROUP BY conversation",
            (since.astimezone(timezone.utc).isoformat(timespec="seconds"),),
        ):
            stats.setdefault(row["conversation"], {})["today_count"] = row["n"]
        for row in self.db.execute(
            "SELECT m.* FROM messages m WHERE m.id = (SELECT id FROM messages x"
            " WHERE x.conversation = m.conversation ORDER BY sent_at DESC, id DESC LIMIT 1)"
        ):
            stats.setdefault(row["conversation"], {})["last_message"] = row
        return stats

    def prune(self, days: int) -> int:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
        with self.db:
            return self.db.execute("DELETE FROM messages WHERE sent_at < ?", (cutoff,)).rowcount

    # --- 审计 ---

    def audit(self, actor: str, action: str, target: str, detail: dict, result: str) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO audit (at, actor, action, target, detail, result)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (_now(), actor, action, target, json.dumps(detail, ensure_ascii=False), result),
            )

    def audit_log(self, limit: int = 30) -> list[sqlite3.Row]:
        rows = self.db.execute(
            "SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return list(reversed(rows))
