import os
import stat
from datetime import datetime, timedelta, timezone

import pytest

from deck import cli
from deck.adapters.base import Conversation, Message
from deck.store import Store
from deck.sync import sync


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

    def send(self, conversation, text, reply_to=None):
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


def test_prune_removes_only_older_than_retention(store):
    adapter = FakeAdapter()
    store.add_conversation("mx", adapter.resolve("群"))
    old = datetime.now(timezone.utc) - timedelta(days=31)
    adapter.pending = [_message("old", "OTHER", "旧", old), _message("new", "OTHER", "新")]
    sync(store, lambda _: adapter)
    assert store.prune(30) == 1
    assert [r["text"] for r in store.timeline()] == ["新"]


@pytest.fixture
def deck_home(tmp_path, monkeypatch):
    monkeypatch.setenv("DECK_HOME", str(tmp_path / "home"))
    adapter = FakeAdapter()
    monkeypatch.setattr(cli, "adapter_for", lambda source, config: adapter)
    assert cli.main(["init", "--dws", "dws", "--drlee", "drlee"]) == 0
    assert cli.main(["project", "add", "mx", "--name", "Management-X"]) == 0
    assert cli.main(["group", "add", "mx", "dingtalk", "测试群"]) == 0
    return adapter


def test_send_without_yes_only_previews(deck_home, capsys):
    capsys.readouterr()
    assert cli.main(["send", "1", "--text", "收到", "--ai"]) == 0
    assert deck_home.sent == []
    assert "【MX 助手】收到" in capsys.readouterr().out


def test_send_with_yes_sends_audits_and_reads_back(deck_home, capsys):
    assert cli.main(["send", "1", "--text", "收到", "--ai", "--yes"]) == 0
    assert deck_home.sent == [("cid", "【MX 助手】收到", None)]
    capsys.readouterr()
    assert cli.main(["timeline", "--mine"]) == 0
    assert "我：【MX 助手】收到" in capsys.readouterr().out
    assert cli.main(["--json", "log"]) == 0
    assert '"actor": "ai"' in capsys.readouterr().out


def test_duplicate_group_is_a_clear_error(deck_home, capsys):
    capsys.readouterr()
    assert cli.main(["group", "add", "mx", "dingtalk", "测试群"]) == 1
    assert "已经存在" in capsys.readouterr().out
