"""数据库结构：按顺序编号的升级步骤，已执行到哪一步记在 PRAGMA user_version。

每个连接只读一次 user_version；只有库比代码旧时才加写锁升级。新增结构变化时在
STEPS 末尾追加一个函数，不要改已有步骤；步骤要能重复执行（旧版本回滚后再升级）。
"""
import sqlite3
from datetime import datetime, timezone

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
CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    project     TEXT REFERENCES projects(key),
    status      TEXT NOT NULL,
    priority    TEXT NOT NULL,
    due         TEXT,
    source      TEXT,
    created_by  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
-- 一个任务可挂多条消息（可来自不同群）；消息过保留期被清理后关联仍在，展示时标为已清理。
CREATE TABLE IF NOT EXISTS task_messages (
    task     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    message  INTEGER NOT NULL,
    added_at TEXT NOT NULL,
    added_by TEXT NOT NULL,
    PRIMARY KEY (task, message)
);
CREATE INDEX IF NOT EXISTS task_messages_message ON task_messages(message);
CREATE TABLE IF NOT EXISTS send_operations (
    id         TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    payload    TEXT NOT NULL,
    preview    TEXT NOT NULL,
    status     TEXT NOT NULL,
    result     TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS handled (
    message INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pairings (
    code_hash  TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
)
"""

# 早期库缺的列。
_ADDED_COLUMNS = {
    "conversations": ("last_sync_at TEXT", "last_error TEXT", "kind TEXT", "read_at TEXT", "rules TEXT"),
    "sessions": ("disabled_at TEXT", "origin TEXT"),
    "messages": ("edited_at TEXT", "retracted_at TEXT", "ai_sent INTEGER"),
}


def _add_column(db: sqlite3.Connection, table: str, column: str) -> None:
    if column.split()[0] not in {row[1] for row in db.execute(f"PRAGMA table_info({table})")}:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {column}")


def _baseline(db: sqlite3.Connection) -> None:
    """建表并补齐编号之前的所有零散升级；对新库和各时期的旧库都可重复执行。"""
    for statement in SCHEMA.split(";"):
        db.execute(statement)
    for table, columns in _ADDED_COLUMNS.items():
        for column in columns:
            _add_column(db, table, column)
    # 群名带 test / 测试 的当测试群，与 store.guess_kind 一致。
    db.execute(
        "UPDATE conversations SET kind = CASE WHEN lower(name) LIKE '%test%' OR name LIKE '%测试%'"
        " THEN 'test' ELSE 'prod' END WHERE kind IS NULL")
    # 钉钉的引用回复以前没记下被引用的消息。
    if not db.execute("SELECT 1 FROM settings WHERE key = 'migrated:reply_to'").fetchone():
        db.execute(
            "UPDATE messages SET reply_to = json_extract(raw, '$.quotedMessage.messageId')"
            " WHERE reply_to IS NULL AND json_valid(raw)"
            " AND json_extract(raw, '$.quotedMessage.messageId') IS NOT NULL")
    if not db.execute("SELECT 1 FROM settings WHERE key = 'migrated:task_messages'").fetchone():
        db.execute(
            "INSERT OR IGNORE INTO task_messages (task, message, added_at, added_by)"
            " SELECT id, json_extract(source, '$.message_id'), created_at, created_by FROM tasks"
            " WHERE json_valid(source) AND json_extract(source, '$.message_id') IS NOT NULL")
    # 已有的群：之前的消息都算看过，免得一上来全是未读。
    db.execute(
        "UPDATE conversations SET read_at = COALESCE((SELECT MAX(sent_at) FROM messages"
        " WHERE conversation = conversations.id), ?) WHERE read_at IS NULL",
        (datetime.now(timezone.utc).isoformat(timespec="seconds"),))


def _audit_via(db: sqlite3.Connection) -> None:
    """操作日志记下从哪个入口发起：web、cli、mcp、watcher。旧记录留空。"""
    _add_column(db, "audit", "via TEXT")


def _module_tables(db: sqlite3.Connection) -> None:
    """AI 用量和待发送附件的表，原先由各模块用到时自己建。"""
    db.execute(
        "CREATE TABLE IF NOT EXISTS ai_calls (id INTEGER PRIMARY KEY, month TEXT NOT NULL,"
        " project TEXT, reserved INTEGER NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,"
        " output_tokens INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, at TEXT NOT NULL)")
    db.execute(
        "CREATE TABLE IF NOT EXISTS upload (id TEXT PRIMARY KEY, owner TEXT NOT NULL,"
        " conv_group INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL,"
        " kind TEXT NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL)")


def _conversation_mode(db: sqlite3.Connection) -> None:
    """会话状态：ai 监听并交给 AI，listen 只监听，off 禁用（不再拉取，保留消息）；chat 区分群聊和单聊。"""
    _add_column(db, "conversations", "mode TEXT NOT NULL DEFAULT 'ai'")
    _add_column(db, "conversations", "chat TEXT NOT NULL DEFAULT 'group'")


def _agents_and_seen(db: sqlite3.Connection) -> None:
    """messages.bot：AI 或机器人发的；conversations.seen_at：在平台上读到哪里（钉钉、channel 自己的已读）。"""
    _add_column(db, "messages", "bot INTEGER NOT NULL DEFAULT 0")
    _add_column(db, "conversations", "seen_at TEXT")
    for source, test in (("channel", "json_extract(raw, '$.sender_kind') = 'agent'"),
                         ("dingtalk", "json_extract(raw, '$.messageAiSendFlag') IS NOT NULL")):
        db.execute(f"UPDATE messages SET bot = 1 WHERE json_valid(raw) AND {test}"
                   " AND conversation IN (SELECT id FROM conversations WHERE source = ?)", (source,))


def _assisted(db: sqlite3.Connection) -> None:
    """channel 拍档自动代发的消息也算 AI 发的。"""
    db.execute(
        "UPDATE messages SET bot = 1 WHERE bot = 0 AND json_valid(raw)"
        " AND conversation IN (SELECT id FROM conversations WHERE source = 'channel')"
        " AND EXISTS (SELECT 1 FROM json_each(raw, '$.blocks') b WHERE json_extract(b.value, '$.type') = 'ai_assisted'"
        " AND json_extract(b.value, '$.automatic'))")


def _drop_reply_timeout(db: sqlite3.Connection) -> None:
    """「回复超时」并入推送级别「高」：去掉旧的覆盖值。"""
    db.execute("UPDATE settings SET value = json_remove(value, '$.reply_reminder_hours')"
               " WHERE key = 'runtime_config' AND json_valid(value)")


def _drop_ignore_senders(db: sqlite3.Connection) -> None:
    """「不提醒的发送人」去掉了：清掉网页、CLI 存过的名单。"""
    db.execute("UPDATE settings SET value = json_remove(value, '$.ignore_senders')"
               " WHERE key = 'runtime_config' AND json_valid(value)")


STEPS = [_baseline, _audit_via, _module_tables, _conversation_mode, _agents_and_seen, _assisted, _drop_reply_timeout, _drop_ignore_senders]


def version(db: sqlite3.Connection) -> int:
    return db.execute("PRAGMA user_version").fetchone()[0]


def ensure(db: sqlite3.Connection) -> None:
    if version(db) >= len(STEPS):
        return
    # 监听线程、网页、命令行可能同时打开旧库：写锁内再确认一次版本。
    db.execute("BEGIN IMMEDIATE")
    try:
        for step in STEPS[version(db):]:
            step(db)
        db.execute(f"PRAGMA user_version = {len(STEPS)}")
        db.commit()
    except BaseException:
        db.rollback()
        raise
