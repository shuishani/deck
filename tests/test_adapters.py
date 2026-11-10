from datetime import datetime, timezone

import pytest

from deck.adapters.channel import ChannelAdapter
from deck.adapters.dingtalk import DingTalkAdapter
from deck.runner import ToolError


class FakeRun:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, argv):
        self.calls.append(list(argv))
        return self.responses.pop(0)


def test_dingtalk_first_fetch_reads_latest_page_and_cursor_is_latest_time():
    run = FakeRun({"messages": [
        {"messageId": "m2", "createTime": "2026-11-09 18:43:05", "sender": "李涛",
         "senderId": "S1", "text": "二"},
        {"messageId": "m1", "createTime": "2026-11-09 18:35:41", "sender": "李涛",
         "senderId": "S1", "text": "一"},
    ]})
    messages, cursor = DingTalkAdapter("dws", run).fetch("cid", None)
    assert run.calls[0] == ["dws", "chat", "+chat-messages", "--group", "cid",
                            "-f", "json", "--limit", "50"]
    assert [m.remote_id for m in messages] == ["m2", "m1"]
    assert cursor == "2026-11-09 18:43:05"
    assert messages[0].sent_at.tzinfo == timezone.utc


def test_dingtalk_next_fetch_starts_from_cursor_and_keeps_it_when_empty():
    run = FakeRun({"messages": []})
    _, cursor = DingTalkAdapter("dws", run).fetch("cid", "2026-11-09 18:43:05")
    assert run.calls[0][5:9] == ["-f", "json", "--start", "2026-11-09 18:43:05"]
    assert "--page-all" in run.calls[0]
    assert cursor == "2026-11-09 18:43:05"


def test_dingtalk_resolve_needs_exactly_one_group():
    groups = {"items": [
        {"conversationId": "cid1", "name": "management-x-dev-TEST"},
        {"conversationId": "cid2", "name": "别的群"},
    ]}
    adapter = DingTalkAdapter("dws", FakeRun(groups, groups))
    assert adapter.resolve("management-x-dev-TEST").remote_id == "cid1"
    with pytest.raises(ToolError):
        adapter.resolve("不存在")


def test_dingtalk_self_ids_maps_user_id_to_message_sender_id():
    run = FakeRun(
        {"user_id": "177"},
        {"messages": [{"messageId": "m", "senderId": "S1"}]},
    )
    assert DingTalkAdapter("dws", run).self_ids("cid") == {"177", "S1"}
    assert run.calls[1][-4:] == ["--limit", "1", "-f", "json"]
    assert ["--sender", "177"] == run.calls[1][5:7]


def test_dingtalk_send_confirms_without_prompt():
    run = FakeRun({"success": True})
    DingTalkAdapter("dws", run).send("cid", "你好")
    assert run.calls[0] == ["dws", "chat", "+send-to-group", "--group", "cid",
                            "--content", "你好", "--yes", "-f", "json"]


def _channel_page(*seqs):
    return {"ok": True, "data": {"latest_sequence": max(seqs, default=0), "items": [
        {"id": f"id{s}", "message_sequence": s, "sender_user_id": "U1",
         "sender_name": "李涛", "text": f"第{s}条", "thread_root_id": None,
         "created_at": "2026-11-09T10:43:06.123456Z"}
        for s in seqs
    ]}}


def test_channel_reads_after_cursor_until_short_page():
    run = FakeRun(_channel_page(*range(3, 53)), _channel_page(53))
    messages, cursor = ChannelAdapter("drlee", run).fetch("ch", "2")
    assert run.calls[0][-2:] == ["--after-sequence", "2"]
    assert run.calls[1][-2:] == ["--after-sequence", "52"]
    assert len(messages) == 51
    assert cursor == "53"
    assert messages[0].sent_at == datetime(2026, 11, 9, 10, 43, 6, 123456, timezone.utc)


def test_channel_first_fetch_reads_one_page_only():
    run = FakeRun(_channel_page(*range(1, 51)))
    _, cursor = ChannelAdapter("drlee", run).fetch("ch", None)
    assert len(run.calls) == 1
    assert "--after-sequence" not in run.calls[0]
    assert cursor == "50"


def test_channel_send_reply():
    run = FakeRun({"ok": True, "data": {}})
    ChannelAdapter("drlee", run).send("ch", "收到", reply_to="m1")
    assert run.calls[0] == ["drlee", "--json", "channel", "messages", "send", "ch",
                            "--text", "收到", "--reply-to", "m1"]
