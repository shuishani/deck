import os
import stat

import pytest

from deck import uploads
from deck.adapters.channel import ChannelAdapter
from deck.adapters.dingtalk import DingTalkAdapter
from deck.config import Config
from deck.runner import ToolError
from deck.store import Store

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


class Run:
    def __init__(self):
        self.calls = []
        self.seen = []

    def __call__(self, argv, cwd=None):
        self.calls.append(list(argv))
        if cwd:
            # dws 只认工作目录里的相对文件：记下调用时目录里有什么。
            self.seen.append(sorted(os.listdir(cwd)))
        return {"ok": True}


@pytest.fixture
def env(tmp_path):
    store = Store(tmp_path / "deck.db")
    return store, Config(home=tmp_path)


def _item(env, name="a.png", data=PNG, owner="u1", group=1):
    return uploads.create(env[0], env[1], owner, group, name, data)


def test_capabilities_are_per_source_and_never_overstate():
    channel = uploads.capabilities("channel")
    assert channel["send_files"] and channel["send_images"] and channel["reply"]
    assert channel["max_attachment_bytes"] == 10 * 1024 * 1024 and channel["max_files"] == 1
    ding = uploads.capabilities("dingtalk")
    assert ding["send_files"] and ding["send_images"] and ding["reply_attachments"] is False
    none = uploads.capabilities("other")
    assert not any(none[k] for k in ("send_text", "send_images", "send_files", "reply", "edit", "retract"))
    assert none["max_files"] == 0


def test_create_stores_private_file_and_returns_public_fields_only(env):
    item = _item(env)
    assert set(item) == {"id", "name", "size", "mime", "kind"}
    assert item["kind"] == "image" and item["mime"] == "image/png" and item["size"] == len(PNG)
    (internal,) = uploads.prepare(env[0], "u1", 1, [item["id"]])
    path = internal["path"]
    assert item["id"] in path and os.path.dirname(path).startswith(str(env[1].home))
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(os.path.dirname(path)).st_mode) == 0o700
    assert open(path, "rb").read() == PNG
    assert "path" not in uploads.public([internal])[0]


@pytest.mark.parametrize("name,data", [
    ("a.exe", b"MZ"), ("a.sh", b"#!/bin/sh"), ("a.png", b"not a png"),
    ("a.png", b""), ("noext", b"x"), ("a.png", PNG + b"0" * (10 * 1024 * 1024)),
])
def test_create_rejects_bad_files(env, name, data):
    with pytest.raises(ValueError):
        _item(env, name, data)
    assert not (env[1].home / "uploads").exists() or not list((env[1].home / "uploads").iterdir())


def test_name_is_sanitised_and_path_never_uses_it(env):
    item = _item(env, "../../etc/pa\x00ss.txt", b"hello")
    assert "/" not in item["name"] and "\x00" not in item["name"] and item["name"].endswith(".txt")
    (internal,) = uploads.prepare(env[0], "u1", 1, [item["id"]])
    assert ".." not in internal["path"] and "pa" not in os.path.basename(internal["path"])


def test_prepare_enforces_owner_group_count_and_existence(env):
    a, b = _item(env), _item(env)
    with pytest.raises(ValueError):
        uploads.prepare(env[0], "u2", 1, [a["id"]])
    with pytest.raises(ValueError):
        uploads.prepare(env[0], "u1", 2, [a["id"]])
    with pytest.raises(ValueError):
        uploads.prepare(env[0], "u1", 1, ["nope"])
    with pytest.raises(ValueError):
        uploads.prepare(env[0], "u1", 1, [a["id"], b["id"]])
    assert uploads.prepare(env[0], "u1", 1, []) == []
    os.unlink(uploads.prepare(env[0], "u1", 1, [a["id"]])[0]["path"])
    with pytest.raises(ValueError):
        uploads.prepare(env[0], "u1", 1, [a["id"]])


def test_get_is_owner_scoped(env):
    item = _item(env)
    assert uploads.get(env[0], "u1", item["id"])["path"]
    assert uploads.get(env[0], "u2", item["id"]) is None


def test_channel_attach_uses_real_cli_flags(env):
    run = Run()
    (internal,) = uploads.prepare(env[0], "u1", 1, [_item(env, "r.txt", b"hi")["id"]])
    uploads.send(ChannelAdapter("drlee", run), "c1", "看看", "m9", False, [internal])
    from pathlib import Path
    assert len(run.calls) == 1
    assert run.calls[0][:-1] == ["drlee", "--json", "channel", "messages", "send", "c1",
                          "--text", "看看", "--reply-to", "m9", "--attach"]
    assert Path(run.calls[0][-1]).name == "r.txt" and run.seen == [["r.txt"]]


def test_channel_attachment_only_has_no_text_flag(env):
    run = Run()
    (internal,) = uploads.prepare(env[0], "u1", 1, [_item(env)["id"]])
    uploads.send(ChannelAdapter("drlee", run, sender="new"), "c1", "", None, True, [internal])
    assert run.calls[0][0] == "drlee" and "--text" not in run.calls[0]


def test_no_items_falls_through_to_plain_send(env):
    run = Run()
    uploads.send(ChannelAdapter("drlee", run), "c1", "hi", None, False, [])
    assert run.calls == [["drlee", "--json", "channel", "messages", "send", "c1", "--text", "hi"]]


def test_dingtalk_file_sends_text_then_file_from_workdir(env):
    run = Run()
    (internal,) = uploads.prepare(env[0], "u1", 1, [_item(env, "r.txt", b"hi")["id"]])
    uploads.send(DingTalkAdapter("dws", run), "cid", "看看", None, False, [internal])
    assert run.calls[0][:4] == ["dws", "chat", "+send-to-group", "--group"]
    file_call = run.calls[1]
    assert file_call[:4] == ["dws", "chat", "+messages-send", "--as"]
    assert ["--msg-type", "file"] == file_call[file_call.index("--msg-type"):file_call.index("--msg-type") + 2]
    relative = file_call[file_call.index("--file") + 1]
    assert not os.path.isabs(relative) and run.seen[-1] == [os.path.basename(relative)]
    assert os.path.basename(relative) == "r.txt"
    assert "--ai-tag=false" in file_call and "--yes" in file_call


def test_dingtalk_image_is_inline_markdown_in_one_message(env):
    run = Run()
    (internal,) = uploads.prepare(env[0], "u1", 1, [_item(env)["id"]])
    uploads.send(DingTalkAdapter("dws", run), "cid", "图", None, True, [internal])
    (call,) = run.calls
    markdown = call[call.index("--markdown") + 1]
    assert markdown.startswith("图\n\n![") and "](./" in markdown
    assert "--ai-tag=true" in call


def test_attachment_filename_matches_the_confirmed_preview(env):
    from pathlib import Path
    (internal,) = uploads.prepare(env[0], "u1", 1, [_item(env, "original-report.txt", b"hi")["id"]])
    channel = Run()
    uploads.send(ChannelAdapter("drlee", channel), "cid", "", None, False, [internal])
    assert Path(channel.calls[0][-1]).name == "original-report.txt"
    ding = Run()
    uploads.send(DingTalkAdapter("dws", ding), "cid", "", None, False, [internal])
    call = ding.calls[0]
    assert Path(call[call.index("--file") + 1]).name == "original-report.txt"


def test_dingtalk_image_caption_cannot_request_other_local_files(env):
    run = Run()
    (internal,) = uploads.prepare(env[0], "u1", 1, [_item(env)["id"]])
    uploads.send(DingTalkAdapter("dws", run), "cid", "![secret](/private/key.txt)", None, False, [internal])
    (call,) = run.calls
    markdown = call[call.index("--markdown") + 1]
    assert markdown.count("![") == 1
    assert "![secret](/private/key.txt)" not in markdown


def test_dingtalk_reply_with_attachment_is_refused_not_downgraded(env):
    run = Run()
    (internal,) = uploads.prepare(env[0], "u1", 1, [_item(env)["id"]])
    with pytest.raises(ValueError):
        uploads.send(DingTalkAdapter("dws", run), "cid", "x", "m1", False, [internal])
    assert run.calls == []


def test_unknown_adapter_and_too_many_items_refused(env):
    class Bare:
        source = "other"

    (internal,) = uploads.prepare(env[0], "u1", 1, [_item(env)["id"]])
    with pytest.raises(ValueError):
        uploads.send(Bare(), "c", "x", None, False, [internal])
    with pytest.raises(ValueError):
        uploads.send(ChannelAdapter("drlee", Run()), "c", "x", None, False, [internal, internal])


def test_dingtalk_file_failure_after_text_reports_text_already_sent(env):
    class Fail(Run):
        def __call__(self, argv, cwd=None):
            super().__call__(argv, cwd)
            if "+messages-send" in argv:
                raise ToolError("boom")
            return {}

    (internal,) = uploads.prepare(env[0], "u1", 1, [_item(env, "r.txt", b"hi")["id"]])
    with pytest.raises(ToolError, match="文字已发送"):
        uploads.send(DingTalkAdapter("dws", Fail()), "cid", "看看", None, False, [internal])
