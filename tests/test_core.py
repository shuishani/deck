import json
import os
import stat
from datetime import datetime, timedelta, timezone

import pytest

from deck import actions, cli, migrations
from deck.adapters.base import ChatState, Conversation, Message
from deck.store import Store
from deck.sync import refresh_chats, sync


class FakeAdapter:
    source = "dingtalk"

    def __init__(self):
        self.pending: list[Message] = []
        self.sent = []
        self.fail = False

    def resolve(self, query):
        return Conversation(self.source, "cid", query)

    def fetch(self, conversation, cursor):
        if self.fail:
            raise RuntimeError("断线")
        messages, self.pending = self.pending, []
        return messages, max([m.remote_id for m in messages] + [cursor or ""]) or None

    def send(self, conversation, text, reply_to=None, ai=False):
        self.sent.append((conversation, text, reply_to))
        self.pending.append(_message("me-1", "ME", text))

    def self_ids(self, conversation):
        return {"ME"}


def _message(id, sender, text, at=None):
    return Message("dingtalk", id, "cid", sender, "李涛" if sender == "ME" else "张三",
                   text, at or datetime.now(timezone.utc))


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "deck.db")
    s.add_project("mx", "Management-X", None)
    yield s
    s.close()


def test_db_file_is_private(tmp_path):
    Store(tmp_path / "deck.db").close()
    assert stat.S_IMODE(os.stat(tmp_path / "deck.db").st_mode) == 0o600


def test_sync_stores_new_messages_once_and_marks_mine(store):
    adapter = FakeAdapter()
    id = store.add_conversation("mx", adapter.resolve("测试群"))
    adapter.pending = [_message("a", "OTHER", "有个 bug"), _message("b", "ME", "我看看")]
    [result] = sync(store, lambda _: adapter)
    assert result.added == 2 and result.error is None
    adapter.pending = [_message("b", "ME", "我看看")]
    assert sync(store, lambda _: adapter)[0].added == 0
    rows = store.timeline("mx")
    assert [(r["text"], r["is_me"]) for r in rows] == [("有个 bug", 0), ("我看看", 1)]
    assert store.conversation(id)["cursor"] == "b"
    assert [r["text"] for r in store.timeline(mine=True)] == ["我看看"]


def test_one_failing_group_does_not_stop_others(store):
    good, bad = FakeAdapter(), FakeAdapter()
    bad.fail = True
    store.add_conversation("mx", Conversation("dingtalk", "cid", "坏的"))
    store.add_conversation("mx", Conversation("channel", "ch", "好的"))
    good.pending = [_message("a", "OTHER", "hi")]
    results = sync(store, lambda source: bad if source == "dingtalk" else good)
    assert results[0].error == "断线"
    assert results[1].added == 1


def test_chat_list_adds_direct_chats_tracks_platform_reads_and_respects_removal(store):
    chat = Conversation("dingtalk", "d1", "张三")
    last = datetime(2026, 11, 9, tzinfo=timezone.utc)

    class Chats:
        source = "dingtalk"

        def __init__(self, last_at, read=None, unread=None):
            self.state = ChatState(chat, True, last_at, read, unread)

        def chats(self, mine):
            return [self.state]

    [id] = refresh_chats(store, Chats(last))
    row = store.conversation(id)
    assert (row["project"], row["chat"], row["mode"], row["kind"]) == ("personal", "direct", "listen", "prod")
    store.set_sync_status(id, None)
    assert refresh_chats(store, Chats(last)) == []
    assert refresh_chats(store, Chats(datetime.now(timezone.utc))) == [id]
    # 平台上还剩 1 条未读：更早的都算读过；读到哪里只往后推。
    times = [datetime(2026, 11, 9, h, tzinfo=timezone.utc) for h in (1, 2, 3)]
    store.add_messages(id, [Message("dingtalk", f"m{i}", "d1", "U2", "张三", "在吗", t) for i, t in enumerate(times)], set())
    refresh_chats(store, Chats(last, unread=1))
    assert store.conversation(id)["seen_at"] == times[1].isoformat()
    refresh_chats(store, Chats(last, read=times[0]))
    assert store.conversation(id)["seen_at"] == times[1].isoformat()
    # 禁用的不同步；移除后像删掉的对话，对方再发新消息才回来。
    store.set_mode(id, "off")
    assert refresh_chats(store, Chats(datetime.now(timezone.utc))) == []
    actions.remove_group(store, id)
    assert refresh_chats(store, Chats(last)) == [] and not store.conversation(id)
    [again] = refresh_chats(store, Chats(datetime(2099, 1, 1, tzinfo=timezone.utc)))
    assert store.conversation(again)["mode"] == "listen" and store.removed_at("dingtalk", "d1") is None


def test_prune_removes_only_older_than_retention(store):
    adapter = FakeAdapter()
    store.add_conversation("mx", adapter.resolve("群"))
    old = datetime.now(timezone.utc) - timedelta(days=31)
    adapter.pending = [_message("old", "OTHER", "旧", old), _message("kept", "OTHER", "任务证据", old),
                       _message("new", "OTHER", "新")]
    sync(store, lambda _: adapter)
    kept = next(r["id"] for r in store.timeline() if r["text"] == "任务证据")
    task = store.add_task({"title": "t", "description": "", "project": None, "status": "todo", "priority": "medium",
                           "due": None, "source": None, "created_by": "me"})
    store.link_task_message(task, kept, "me")
    assert store.prune(30) == 1
    assert [r["text"] for r in store.timeline()] == ["任务证据", "新"]
    store.remove_task(task)
    assert store.prune(30) == 1


@pytest.fixture
def deck_home(tmp_path, monkeypatch):
    monkeypatch.setenv("DECK_HOME", str(tmp_path / "home"))
    adapter = FakeAdapter()
    monkeypatch.setattr(cli, "adapter_for", lambda source, config: adapter)
    assert cli.main(["init", "--dws", "dws", "--drlee", "drlee"]) == 0
    assert cli.main(["project", "add", "mx", "--name", "Management-X"]) == 0
    assert cli.main(["group", "add", "mx", "dingtalk", "测试群"]) == 0
    return adapter


def test_cli_ai_placeholder_and_full_search_use_the_same_core(deck_home, capsys):
    import json
    capsys.readouterr()
    assert cli.main(['--json', 'ai', 'settings']) == 0
    assert not json.loads(capsys.readouterr().out)['settings']['enabled']
    assert cli.main(['ai', 'configure', '{"model":"compatible-placeholder"}']) == 0
    assert cli.main(['ai', 'ask', '你好']) == 1
    capsys.readouterr()
    deck_home.pending.append(_message('old-search', 'OTHER', '命令行搜索词'))
    assert cli.main(['sync']) == 0
    capsys.readouterr()
    assert cli.main(['--json', 'search', '命令行搜索词']) == 0
    assert json.loads(capsys.readouterr().out)['hits'][0]['message']['remote_id'] == 'old-search'


def test_cli_can_confirm_the_same_send_operation_twice(deck_home, capsys):
    import json

    capsys.readouterr()
    assert cli.main(["--json", "send", "1", "--text", "仅发一次"]) == 0
    preview = json.loads(capsys.readouterr().out)["preview"]
    assert "operation_id" in preview
    command = ["--json", "send", "1", "--operation", preview["operation_id"], "--yes"]
    assert cli.main(command) == 0
    assert json.loads(capsys.readouterr().out)["sent"]
    assert cli.main(command) == 0
    assert deck_home.sent == [("cid", "仅发一次", None)]


def test_cli_edits_settings_and_project_without_replacing_history(deck_home, capsys):
    assert cli.main(["config", "set", '{"poll_seconds": 15}']) == 0
    capsys.readouterr()
    assert cli.main(["--json", "config", "show"]) == 0
    assert '"poll_seconds": 15' in capsys.readouterr().out
    assert cli.main(["project", "set", "mx", "--name", "新名称"]) == 0
    assert cli.main(["group", "rules", "1", '{"scope": "mentions"}']) == 0
    assert cli.main(["project", "add", "other", "--name", "其他项目"]) == 0
    assert cli.main(["group", "move", "1", "other"]) == 0
    capsys.readouterr()
    assert cli.main(["--json", "group", "list"]) == 0
    assert '"project": "other"' in capsys.readouterr().out


def test_send_without_yes_only_previews(deck_home, capsys):
    capsys.readouterr()
    assert cli.main(["send", "1", "--text", "收到", "--ai"]) == 0
    assert deck_home.sent == []
    # 钉钉自己会标「通过 AI 发送」，不加文字前缀。
    assert "\n收到\n" in capsys.readouterr().out


def test_send_with_yes_sends_audits_and_reads_back(deck_home, capsys):
    assert cli.main(["send", "1", "--text", "收到", "--ai", "--yes"]) == 0
    assert deck_home.sent == [("cid", "收到", None)]
    capsys.readouterr()
    assert cli.main(["timeline", "--mine"]) == 0
    assert "我：收到" in capsys.readouterr().out
    assert cli.main(["--json", "log", "--category", "message"]) == 0
    entry = json.loads(capsys.readouterr().out)["entries"][0]
    assert (entry["actor"], entry["as_ai"], entry["label"]) == ("me", True, "发送消息")


def test_duplicate_group_is_a_clear_error(deck_home, capsys):
    capsys.readouterr()
    assert cli.main(["group", "add", "mx", "dingtalk", "测试群"]) == 1
    assert "记录已存在" in capsys.readouterr().out


def test_old_groups_get_a_kind_when_the_column_is_added(tmp_path):
    path = tmp_path / "deck.db"
    s = Store(path)
    s.add_project("mx", "Management-X", None)
    s.add_conversation("mx", Conversation("dingtalk", "a", "management-x-dev-TEST"))
    s.add_conversation("mx", Conversation("channel", "b", "MX 客户群"))
    s.db.execute("UPDATE conversations SET kind = NULL")
    s.db.commit()
    s.close()
    # 库已是最新版本：打开连接不再重跑升级。
    s = Store(path)
    assert [r["kind"] for r in s.conversations()] == [None, None]
    s.db.execute("PRAGMA user_version = 0")
    s.db.commit()
    s.close()
    s = Store(path)
    assert [r["kind"] for r in s.conversations()] == ["test", "prod"]
    assert migrations.version(s.db) == len(migrations.STEPS)
    s.close()


def test_task_cli_round_trip(deck_home, capsys):
    assert cli.main(["task", "add", "整理监听规则", "--project", "mx", "--due", "2026-11-20"]) == 0
    assert cli.main(["task", "done", "1"]) == 0
    capsys.readouterr()
    assert cli.main(["task", "list"]) == 0
    assert capsys.readouterr().out.strip() == "暂无任务"
    assert cli.main(["--json", "task", "list", "--all"]) == 0
    assert '"status": "done"' in capsys.readouterr().out
    assert cli.main(["task", "set", "1", "--due", "明天"]) == 1
    assert cli.main(["task", "remove", "1"]) == 0


def test_ai_sent_messages_are_remembered_locally(deck_home, capsys):
    assert cli.main(["send", "1", "--text", "收到", "--ai", "--yes"]) == 0
    from deck import config as config_module
    s = Store(config_module.load().db_path)
    rows = [(r["text"], r["ai_sent"]) for r in s.db.execute("SELECT text, ai_sent FROM messages")]
    s.close()
    assert rows == [("收到", 1)]


def test_ai_sent_is_marked_when_listener_stores_it_before_send_returns(store):
    from types import SimpleNamespace

    from deck import actions

    adapter = FakeAdapter()
    id = store.add_conversation("mx", adapter.resolve("测试群"))
    real_send = adapter.send

    def send_and_listen(*args, **kwargs):
        real_send(*args, **kwargs)
        sync(store, lambda _: adapter, conversation=id)

    adapter.send = send_and_listen
    actions.send(store, SimpleNamespace(ai_prefix=""), lambda _: adapter, id, "收到", None, ai=True)
    assert [(r["text"], r["ai_sent"]) for r in store.db.execute("SELECT text, ai_sent FROM messages")] == [("收到", 1)]


def test_serve_banner_only_shows_login_code_when_given():
    known = [{"kind": "local", "url": "http://127.0.0.1:8765/", "label": "本机", "secure": True}]
    assert "code=abc" in cli._serve_banner(known, "abc", watching=True)
    background = cli._serve_banner(known, None, watching=True)
    assert "code=" not in background and "deck access link" in background


def test_log_over_limit_moves_to_backup_and_restarts(tmp_path):
    path = tmp_path / "server.out.log"
    path.write_text("旧日志" * 10)
    with open(path, "a") as stream:
        cli._trim_log(stream, limit=1 << 20)
        assert path.read_text() == "旧日志" * 10
        cli._trim_log(stream, limit=10)
        stream.write("新日志\n")
    assert path.read_text() == "新日志\n"
    backup = tmp_path / "server.out.log.1"
    assert backup.read_text() == "旧日志" * 10
    assert stat.S_IMODE(backup.stat().st_mode) == 0o600


def test_task_cli_links_messages(deck_home, capsys):
    assert cli.main(["send", "1", "--text", "也遇到了", "--yes"]) == 0
    assert cli.main(["task", "add", "同一个问题"]) == 0
    assert cli.main(["task", "link", "1", "1"]) == 0
    assert cli.main(["task", "link", "1", "999"]) == 1
    capsys.readouterr()
    assert cli.main(["task", "show", "1"]) == 0
    out = capsys.readouterr().out
    assert "同一个问题" in out and "\n#1 " in out
    assert cli.main(["task", "unlink", "1", "1"]) == 0


def test_call_runs_registered_operations_and_records_the_entry(deck_home, capsys):
    import json
    from deck import config as config_module
    capsys.readouterr()
    assert cli.main(["call"]) == 0
    listed = capsys.readouterr().out
    assert "tasks.create" in listed and "auth.login" not in listed
    assert cli.main(["call", "tasks.create", '{"title": "对齐接口", "project": "mx"}']) == 0
    task = json.loads(capsys.readouterr().out)["task"]
    assert cli.main(["call", "tasks.get", json.dumps({"id": task["id"]})]) == 0
    assert json.loads(capsys.readouterr().out)["task"]["title"] == "对齐接口"
    assert cli.main(["call", "auth.login", "{}"]) == 1
    assert cli.main(["call", "tasks.create", "[]"]) == 1
    s = Store(config_module.load().db_path)
    assert s.db.execute("SELECT via FROM audit WHERE action = 'task.add'").fetchone()[0] == "cli"
    s.close()
