import hashlib
import json
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import migrations
from .adapters.base import Conversation, Message

_MESSAGE_SELECT = (
    "SELECT m.*, c.project, c.source, c.rules, c.chat, c.name AS conversation_name"
    " FROM messages m JOIN conversations c ON c.id = m.conversation"
)


_MEDIA_NAME = re.compile(r"(\d+)-\d+(?:\.\w+)?$")


def _revision(raw: dict | str | None) -> tuple:
    data = json.loads(raw) if isinstance(raw, str) and raw else raw or {}
    return data.get("revision"), data.get("deleted_at"), data.get("edited_at")


# 单聊不属于哪个项目，统一挂在这个内置项目下。
PERSONAL = "personal"


def guess_kind(name: str) -> str:
    """群名带 test / 测试 的当测试群，其余当正式群（发送前多一道确认）。"""
    return "test" if "test" in name.lower() or "测试" in name else "prod"


def _digest(value) -> str:
    return hashlib.sha1(repr(tuple(value) if isinstance(value, sqlite3.Row) else value).encode()).hexdigest()[:12]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: Path, via: str = "cli"):
        # 这个连接代表哪个入口：web、cli、mcp、watcher，写进操作日志。
        self.via = via
        if not path.exists():
            # 先建好只有本人能读写的空文件，再交给 sqlite。
            os.close(os.open(path, os.O_CREAT | os.O_WRONLY, 0o600))
        # 监听线程、网页、命令行会同时读写：WAL + 等锁。
        self.media_dir = path.parent / "media"
        self.db = sqlite3.connect(path, timeout=15)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = WAL")
        migrations.ensure(self.db)

    def close(self) -> None:
        self.db.close()

    _VERSION_QUERIES = {
        "messages": (
            "SELECT IFNULL(MAX(id), 0), COUNT(*), IFNULL(MAX(edited_at), ''), IFNULL(MAX(retracted_at), ''),"
            " (SELECT COUNT(*) || ':' || IFNULL(MAX(at), '') FROM handled),"
            " (SELECT group_concat(id || ':' || IFNULL(read_at, '')) FROM conversations)"
            " FROM messages"),
        "groups": (
            "SELECT (SELECT group_concat(id || ':' || project || ':' || name || ':' || IFNULL(kind, '')"
            "  || ':' || IFNULL(rules, '') || ':' || mode, '|') FROM conversations),"
            " (SELECT group_concat(key || ':' || name || ':' || IFNULL(repo, ''), '|') FROM projects)"),
        "tasks": (
            "SELECT (SELECT COUNT(*) || ':' || IFNULL(MAX(updated_at), '') FROM tasks),"
            " (SELECT COUNT(*) || ':' || IFNULL(MAX(added_at), '') FROM task_messages)"),
        "config": (
            "SELECT group_concat(key || '=' || value, '|') FROM settings"
            " WHERE key NOT LIKE 'migrated:%' AND key != 'local_password'"),
    }

    def versions(self) -> dict[str, str]:
        """各类数据的版本：内容变了才变，网页按类只重拉变了的部分。同步时间不算在内。"""
        return {name: _digest(self.db.execute(sql).fetchone()) for name, sql in self._VERSION_QUERIES.items()}

    # --- 项目 ---

    def add_project(self, key: str, name: str, repo: str | None) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO projects (key, name, repo, created_at) VALUES (?, ?, ?, ?)",
                (key, name, repo, _now()),
            )

    def update_project(self, key: str, fields: dict) -> None:
        if fields:
            columns = ", ".join(f"{k} = ?" for k in fields)
            with self.db:
                self.db.execute(f"UPDATE projects SET {columns} WHERE key = ?", [*fields.values(), key])

    def move_conversation(self, id: int, project: str) -> None:
        with self.db:
            self.db.execute("UPDATE conversations SET project = ? WHERE id = ?", (project, id))

    def projects(self) -> list[sqlite3.Row]:
        return self.db.execute("SELECT * FROM projects ORDER BY key").fetchall()

    def project(self, key: str) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM projects WHERE key = ?", (key,)).fetchone()

    # --- 会话（监测的群） ---

    def add_conversation(self, project: str, conversation: Conversation, chat: str = "group",
                         mode: str = "ai") -> int:
        # 单聊是发给真人的，按正式会话对待：发送前多一道确认。
        kind = "prod" if chat == "direct" else guess_kind(conversation.name)
        with self.db:
            if project == PERSONAL:
                self.db.execute("INSERT OR IGNORE INTO projects (key, name, repo, created_at)"
                                " VALUES (?, '个人', NULL, ?)", (PERSONAL, _now()))
            cursor = self.db.execute(
                "INSERT INTO conversations (project, source, remote_id, name, added_at, kind, read_at, chat, mode)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (project, conversation.source, conversation.remote_id,
                 conversation.name, _now(), kind, _now(), chat, mode),
            )
        return int(cursor.lastrowid)

    def conversations(self, project: str | None = None) -> list[sqlite3.Row]:
        if project:
            return self.db.execute(
                "SELECT * FROM conversations WHERE project = ? ORDER BY id", (project,)
            ).fetchall()
        return self.db.execute("SELECT * FROM conversations ORDER BY id").fetchall()

    def setting(self, key: str) -> dict:
        row = self.db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else {}

    def set_setting(self, key: str, value: dict) -> None:
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                            (key, json.dumps(value, ensure_ascii=False)))

    def update_settings(self, values: dict, reset: list[str] | tuple = ()) -> dict:
        with self.db:
            # 先取得写锁再读，避免两个设备修改不同设置时互相覆盖。
            self.db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('runtime_config', '{}')")
            merged = {k: v for k, v in {**self.setting("runtime_config"), **values}.items() if k not in reset}
            self.db.execute("UPDATE settings SET value = ? WHERE key = 'runtime_config'",
                            (json.dumps(merged, ensure_ascii=False),))
        return merged

    def set_rules(self, id: int, rules: dict) -> None:
        with self.db:
            self.db.execute("UPDATE conversations SET rules = ? WHERE id = ?",
                            (json.dumps(rules, ensure_ascii=False), id))

    def paused_sources(self) -> set[str]:
        rows = self.db.execute("SELECT key FROM settings WHERE key LIKE 'paused:%'").fetchall()
        return {row[0].removeprefix("paused:") for row in rows}

    def set_source_paused(self, source: str, paused: bool) -> None:
        with self.db:
            if paused:
                self.db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')",
                                (f"paused:{source}",))
            else:
                self.db.execute("DELETE FROM settings WHERE key = ?", (f"paused:{source}",))

    def conversation(self, id: int) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM conversations WHERE id = ?", (id,)).fetchone()

    def remove_conversation(self, id: int) -> bool:
        with self.db:
            removed = self.db.execute("DELETE FROM conversations WHERE id = ?", (id,)).rowcount > 0
        self.clean_media()
        return removed

    def mark_read(self, id: int) -> bool:
        """把这个群读到最新一条。"""
        with self.db:
            return self.db.execute(
                "UPDATE conversations SET read_at = MAX(IFNULL(read_at, ''), IFNULL((SELECT MAX(sent_at)"
                " FROM messages WHERE conversation = ?), '')) WHERE id = ?", (id, id)).rowcount > 0

    def unread_counts(self) -> dict[int, int]:
        rows = self.db.execute(
            "SELECT m.conversation, COUNT(*) AS n FROM messages m"
            " JOIN conversations c ON c.id = m.conversation"
            " WHERE m.is_me = 0 AND m.bot = 0 AND m.sent_at > MAX(IFNULL(c.read_at, ''), IFNULL(c.seen_at, ''))"
            " GROUP BY m.conversation").fetchall()
        return {row["conversation"]: row["n"] for row in rows}

    def set_seen(self, id: int, at: datetime) -> None:
        """平台上读到了 at（只往后推）：之前的不算未读，也不再算需回复。"""
        value = at.astimezone(timezone.utc).isoformat(timespec="seconds")
        with self.db:
            self.db.execute("UPDATE conversations SET seen_at = ? WHERE id = ? AND IFNULL(seen_at, '') < ?",
                            (value, id, value))

    def read_before_unread(self, id: int, unread: int) -> datetime | None:
        """平台说有 unread 条未读：别人发的最新 unread 条之前的都算读过。本地还没同步到的新消息只会让结果更保守。"""
        row = self.db.execute("SELECT sent_at FROM messages WHERE conversation = ? AND is_me = 0"
                              " ORDER BY sent_at DESC, id DESC LIMIT 1 OFFSET ?", (id, unread)).fetchone()
        return datetime.fromisoformat(row[0]) if row else None

    def remember_removed(self, source: str, remote_id: str) -> None:
        """移除的单聊：记下时间，之后没有更新的消息就不自动加回来。"""
        removed = self.setting("removed_direct")
        self.set_setting("removed_direct", {**removed, f"{source}:{remote_id}": _now()})

    def removed_at(self, source: str, remote_id: str) -> datetime | None:
        at = self.setting("removed_direct").get(f"{source}:{remote_id}")
        return datetime.fromisoformat(at) if at else None

    def forget_removed(self, source: str, remote_id: str) -> None:
        removed = self.setting("removed_direct")
        self.set_setting("removed_direct", {k: v for k, v in removed.items() if k != f"{source}:{remote_id}"})

    def rename_conversation(self, id: int, name: str) -> None:
        with self.db:
            self.db.execute("UPDATE conversations SET name = ? WHERE id = ?", (name, id))

    def set_mode(self, id: int, mode: str) -> bool:
        with self.db:
            return self.db.execute(
                "UPDATE conversations SET mode = ? WHERE id = ?", (mode, id)).rowcount > 0

    def set_kind(self, id: int, kind: str) -> bool:
        with self.db:
            return self.db.execute(
                "UPDATE conversations SET kind = ? WHERE id = ?", (kind, id)).rowcount > 0

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
                " sender_name, is_me, text, sent_at, reply_to, raw, bot)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (conversation, m.remote_id, m.sender_id, m.sender_name,
                     int(m.sender_id in mine), m.text,
                     m.sent_at.isoformat(timespec="seconds"), m.reply_to,
                     json.dumps(m.raw, ensure_ascii=False), int(m.bot))
                    for m in messages
                ],
            )
        return self.db.total_changes - before

    def message_by_remote(self, conversation: int, remote_id: str) -> sqlite3.Row | None:
        return self.db.execute(
            _MESSAGE_SELECT + " WHERE m.conversation = ? AND m.remote_id = ?",
            (conversation, remote_id)).fetchone()

    def message(self, id: int) -> sqlite3.Row | None:
        return self.db.execute(_MESSAGE_SELECT + " WHERE m.id = ?", (id,)).fetchone()

    def update_message(self, id: int, text: str, raw: dict) -> None:
        with self.db:
            self.db.execute("UPDATE messages SET text = ?, raw = ? WHERE id = ?",
                            (text, json.dumps(raw, ensure_ascii=False), id))

    def create_send(self, id: str, owner: str, payload: dict, preview: dict, expires: str) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO send_operations (id, owner, payload, preview, status, created_at, expires_at)"
                " VALUES (?, ?, ?, ?, 'draft', ?, ?)",
                (id, owner, json.dumps(payload, ensure_ascii=False), json.dumps(preview, ensure_ascii=False),
                 _now(), expires))

    def send_operation(self, id: str, owner: str) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM send_operations WHERE id = ? AND owner = ?",
                               (id, owner)).fetchone()

    def claim_send(self, id: str) -> bool:
        with self.db:
            return self.db.execute("UPDATE send_operations SET status = 'sending'"
                                   " WHERE id = ? AND status = 'draft'", (id,)).rowcount > 0

    def finish_send(self, id: str, result: dict) -> None:
        with self.db:
            self.db.execute("UPDATE send_operations SET status = ?, result = ? WHERE id = ?",
                            (result["status"], json.dumps(result, ensure_ascii=False), id))

    def sent_message(self, conversation: int, after: int, text: str | None) -> sqlite3.Row | None:
        """after 之后我发的最新一条；text 为 None 时不按文字匹配。"""
        return self.db.execute(_MESSAGE_SELECT + " WHERE m.conversation = ? AND m.id > ?"
                               " AND m.is_me = 1 AND (? IS NULL OR m.text = ?) ORDER BY m.id DESC LIMIT 1",
                               (conversation, after, text, text)).fetchone()

    def latest_message_id(self, conversation: int) -> int:
        row = self.db.execute("SELECT IFNULL(MAX(id), 0) FROM messages WHERE conversation = ?",
                              (conversation,)).fetchone()
        return int(row[0])

    def mark_ai_sent(self, conversation: int, after: int, text: str | None) -> None:
        """按文字标最新一条；text 为 None 时把 after 之后我发的都标上（一次发送拆成多条时）。"""
        with self.db:
            if text is None:
                self.db.execute("UPDATE messages SET ai_sent = 1 WHERE conversation = ? AND id > ? AND is_me = 1",
                                (conversation, after))
                return
            self.db.execute(
                "UPDATE messages SET ai_sent = 1 WHERE id = (SELECT id FROM messages WHERE"
                " conversation = ? AND id > ? AND is_me = 1 AND text = ? ORDER BY id DESC LIMIT 1)",
                (conversation, after, text))

    def mark_edited(self, id: int) -> None:
        with self.db:
            self.db.execute("UPDATE messages SET edited_at = ? WHERE id = ?", (_now(), id))

    def mark_retracted(self, id: int) -> None:
        with self.db:
            self.db.execute("UPDATE messages SET retracted_at = ? WHERE id = ?", (_now(), id))

    def refresh(self, conversation: int, messages: list[Message]) -> int:
        """已存的消息在平台上被编辑、撤回后，用新内容覆盖本地。返回更新条数。"""
        changed = 0
        with self.db:
            for message in messages:
                row = self.db.execute(
                    "SELECT id, text, raw FROM messages WHERE conversation = ? AND remote_id = ?",
                    (conversation, message.remote_id)).fetchone()
                # 已读数之类一直在变，只看内容、版本号和删除时间。
                if row and (row["text"], *_revision(row["raw"])) != (message.text, *_revision(message.raw)):
                    self.db.execute("UPDATE messages SET text = ?, raw = ? WHERE id = ?",
                                    (message.text, json.dumps(message.raw, ensure_ascii=False), row["id"]))
                    changed += 1
        return changed

    def transcribing(self, conversation: int, since: datetime) -> list[sqlite3.Row]:
        """还在等语音转写结果的消息。"""
        return self.db.execute(
            "SELECT * FROM messages WHERE conversation = ? AND sent_at >= ?"
            " AND (raw LIKE '%\"transcription_status\": \"processing\"%'"
            "  OR raw LIKE '%\"transcription_status\": \"pending\"%')",
            (conversation, since.astimezone(timezone.utc).isoformat(timespec="seconds")),
        ).fetchall()

    def candidates(self, project: str | None, since: datetime | None = None) -> list[sqlite3.Row]:
        """别人发的、还没标记处理的消息，附带我是否已引用回复过它，按时间从旧到新。"""
        return self.db.execute(
            _MESSAGE_SELECT.replace("SELECT m.*", "SELECT m.*, EXISTS (SELECT 1 FROM messages r"
                                    " WHERE r.conversation = m.conversation AND r.is_me = 1 AND r.bot = 0"
                                    " AND r.reply_to = m.remote_id) AS quoted,"
                                    " EXISTS (SELECT 1 FROM messages r WHERE r.conversation = m.conversation"
                                    " AND r.is_me = 1 AND r.bot = 0 AND r.sent_at > m.sent_at) AS answered")
            + " WHERE m.is_me = 0 AND m.bot = 0 AND c.mode != 'off' AND m.sent_at > IFNULL(c.seen_at, '')"
            " AND (? IS NULL OR c.project = ?) AND (? IS NULL OR m.sent_at >= ?)"
            " AND NOT EXISTS (SELECT 1 FROM handled h WHERE h.message = m.id)"
            " ORDER BY m.sent_at, m.id",
            (project, project, since, since.astimezone(timezone.utc).isoformat(timespec="seconds") if since else None),
        ).fetchall()

    def my_remote_ids(self) -> set[str]:
        return {row["remote_id"] for row in self.db.execute(
            "SELECT remote_id FROM messages WHERE is_me = 1")}

    def set_handled(self, id: int, handled: bool) -> None:
        with self.db:
            if handled:
                self.db.execute(
                    "INSERT OR IGNORE INTO handled (message, at) SELECT id, ? FROM messages WHERE id = ?",
                    (_now(), id))
            else:
                self.db.execute("DELETE FROM handled WHERE message = ?", (id,))

    def handled_ids(self, ids: list[int]) -> set[int]:
        if not ids:
            return set()
        rows = self.db.execute(
            f"SELECT message FROM handled WHERE message IN ({', '.join('?' * len(ids))})", ids)
        return {row["message"] for row in rows}

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
        """挂在任务上的消息是任务的证据，任务还在就不删；任务删除后下次清理再删。"""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
        with self.db:
            removed = self.db.execute(
                "DELETE FROM messages WHERE sent_at < ? AND id NOT IN (SELECT message FROM task_messages)",
                (cutoff,)).rowcount
        self.clean_media()
        return removed

    def clean_media(self) -> int:
        """删掉消息已经不在了的附件缓存。"""
        if not self.media_dir.is_dir():
            return 0
        alive = {row["id"] for row in self.db.execute("SELECT id FROM messages")}
        removed = 0
        for file in self.media_dir.iterdir():
            match = _MEDIA_NAME.match(file.name)
            if file.is_file() and match and int(match[1]) not in alive:
                file.unlink(missing_ok=True)
                removed += 1
        return removed

    # --- 任务 ---

    def tasks(self, project: str | None = None, status: str | None = None) -> list[sqlite3.Row]:
        """新建的在前。"""
        return self.db.execute(
            "SELECT t.*, (SELECT COUNT(*) FROM task_messages WHERE task = t.id) AS message_count FROM tasks t"
            " WHERE (? IS NULL OR project = ?) AND (? IS NULL OR status = ?)"
            " ORDER BY created_at DESC, id DESC",
            (project, project, status, status),
        ).fetchall()

    def task(self, id: int) -> sqlite3.Row | None:
        return self.db.execute(
            "SELECT t.*, (SELECT COUNT(*) FROM task_messages WHERE task = t.id) AS message_count FROM tasks t"
            " WHERE id = ?", (id,)).fetchone()

    def add_task(self, fields: dict) -> int:
        now = _now()
        row = {**fields, "created_at": now, "updated_at": now}
        source = json.loads(fields["source"]) if fields.get("source") else None
        with self.db:
            cursor = self.db.execute(
                f"INSERT INTO tasks ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
                tuple(row.values()),
            )
            if source:
                self.db.execute("INSERT INTO task_messages (task, message, added_at, added_by) VALUES (?, ?, ?, ?)",
                                (cursor.lastrowid, source["message_id"], now, fields["created_by"]))
        return int(cursor.lastrowid)

    def update_task(self, id: int, fields: dict) -> bool:
        row = {**fields, "updated_at": _now()}
        with self.db:
            return self.db.execute(
                f"UPDATE tasks SET {', '.join(f'{k} = ?' for k in row)} WHERE id = ?",
                (*row.values(), id),
            ).rowcount > 0

    def remove_task(self, id: int) -> bool:
        with self.db:
            return self.db.execute("DELETE FROM tasks WHERE id = ?", (id,)).rowcount > 0

    def task_links(self, message_ids: list[int]) -> dict[int, list[sqlite3.Row]]:
        """消息 id → 挂着它的任务（旧到新）。"""
        if not message_ids:
            return {}
        marks = ",".join("?" * len(message_ids))
        rows = self.db.execute(
            "SELECT t.id, t.title, t.status, l.message FROM task_messages l JOIN tasks t ON t.id = l.task"
            f" WHERE l.message IN ({marks}) ORDER BY t.id", tuple(message_ids)).fetchall()
        links: dict[int, list[sqlite3.Row]] = {}
        for row in rows:
            links.setdefault(row["message"], []).append(row)
        return links

    def task_message_ids(self, task: int) -> list[int]:
        """按消息时间排；已被清理的消息排最后。"""
        return [row[0] for row in self.db.execute(
            "SELECT l.message FROM task_messages l LEFT JOIN messages m ON m.id = l.message"
            " WHERE l.task = ? ORDER BY m.sent_at IS NULL, m.sent_at, l.message", (task,))]

    def link_task_message(self, task: int, message: int, actor: str) -> bool:
        with self.db:
            return self.db.execute(
                "INSERT OR IGNORE INTO task_messages (task, message, added_at, added_by) VALUES (?, ?, ?, ?)",
                (task, message, _now(), actor)).rowcount > 0

    def unlink_task_message(self, task: int, message: int) -> bool:
        with self.db:
            return self.db.execute("DELETE FROM task_messages WHERE task = ? AND message = ?",
                                   (task, message)).rowcount > 0

    # --- 审计 ---

    def audit(self, actor: str, action: str, target: str, detail: dict, result: str) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO audit (at, actor, action, target, detail, result, via)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (_now(), actor, action, target, json.dumps(detail, ensure_ascii=False), result, self.via),
            )

    def audit_log(self, limit: int = 30) -> list[sqlite3.Row]:
        rows = self.db.execute(
            "SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return list(reversed(rows))

    def audit_head(self) -> int:
        return self.db.execute("SELECT IFNULL(MAX(id), 0) FROM audit").fetchone()[0]

    def audit_query(self, *, prefixes: tuple[str, ...] = (), exclude: tuple[str, ...] = (), failed: bool = False,
                    actor: str | None = None, search: str = "", since: str | None = None,
                    before: int | None = None, limit: int = 50) -> tuple[list[sqlite3.Row], bool]:
        """新到旧；多取一条判断还有没有更早的。"""
        where, params = [], []
        if prefixes:
            where.append("(" + " OR ".join("action LIKE ?" for _ in prefixes) + ")")
            params += [f"{p}%" for p in prefixes]
        if exclude:
            where.append(f"action NOT IN ({','.join('?' * len(exclude))})")
            params += exclude
        if failed:
            where.append("result LIKE 'error%'")
        if actor:
            where.append("actor = ?")
            params.append(actor)
        if search:
            where.append("(instr(detail, ?) OR instr(target, ?) OR instr(action, ?) OR instr(result, ?))")
            params += [search] * 4
        if since:
            where.append("at >= ?")
            params.append(since)
        if before:
            where.append("id < ?")
            params.append(before)
        sql = "SELECT * FROM audit" + (" WHERE " + " AND ".join(where) if where else "")
        rows = self.db.execute(sql + " ORDER BY id DESC LIMIT ?", (*params, limit + 1)).fetchall()
        return rows[:limit], len(rows) > limit
