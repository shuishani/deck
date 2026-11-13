from datetime import datetime, timezone
from pathlib import Path

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
                            "--content", "你好", "--ai-tag=false", "--yes", "-f", "json"]


def test_dingtalk_reply_quotes_and_ai_keeps_the_tag():
    run = FakeRun({"success": True})
    DingTalkAdapter("dws", run).send("cid", "收到", reply_to="msg1", ai=True)
    assert run.calls[0] == ["dws", "chat", "+messages-reply", "--group", "cid", "--message-id",
                            "msg1", "--content", "收到", "--ai-tag=true", "--yes", "-f", "json"]


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


def test_dingtalk_content_strips_placeholders_and_keeps_one_ref_per_image():
    from deck.content import parse
    ref = {"download": {"arguments": {"resource-id": "r", "message-id": "m",
                                      "open-conversation-id": "c", "type": "mediaId"}}}
    text, [image] = parse("dingtalk", {"resourceRefs": [ref, {**ref, "contentType": "image"}]},
                          "看下这个 [图片消息](mediaId=@abc)")
    assert (text, image.kind, image.ref["resource-id"]) == ("看下这个", "image", "r")
    text, [voice] = parse("dingtalk", {"resourceRefs": [{**ref, "contentType": "audio"}]},
                          "这是一条测试消息\n[语音消息](mediaId=@xyz)")
    assert (text, voice.kind, voice.transcript) == ("", "voice", "这是一条测试消息")


def test_channel_content_reads_files_and_voice_blocks():
    from deck.content import parse
    raw = {"channel_id": "ch", "blocks": [
        {"type": "voice", "file_id": "v", "duration_ms": 2086, "transcription_status": "processing"}],
        "files": [{"id": "v", "filename": "voice.m4a", "mime_type": "audio/mp4", "file_size": 3},
                  {"id": "i", "filename": "a.jpg", "mime_type": "image/jpeg", "width": 7, "height": 8}]}
    text, [voice, image] = parse("channel", raw, "")
    assert (voice.kind, voice.duration_ms, voice.transcribing, voice.transcript) == (
        "voice", 2086, True, None)
    assert (image.kind, image.width, image.ref) == (
        "image", 7, {"channel_id": "ch", "file_id": "i", "name": "a.jpg"})



def test_dingtalk_download_runs_in_a_scratch_dir_and_moves_the_file(tmp_path):
    seen = {}

    def run(argv, cwd=None):
        seen["argv"], seen["cwd"] = argv, cwd
        (Path(cwd) / "abc.JPG").write_bytes(b"img")
        return {"success": True}

    adapter = DingTalkAdapter("dws", run=run)
    path = adapter.download({"resource-id": "r", "message-id": "m", "open-conversation-id": "c",
                             "type": "mediaId"}, tmp_path / "5-0")
    assert path == tmp_path / "5-0.jpg" and path.read_bytes() == b"img"
    assert seen["argv"][seen["argv"].index("--output") + 1] == "."
    assert list(tmp_path.iterdir()) == [path]


def test_channel_refetch_reads_the_same_message_again():
    def run(argv):
        assert argv[-2:] == ["--after-sequence", "6"]
        return {"data": [{"id": "m1", "created_at": "2026-11-10T06:56:20Z", "text": "",
                          "message_sequence": 7, "blocks": [{"type": "voice", "transcript": "你好"}]}]}

    fresh = ChannelAdapter("drlee", run=run).refetch("ch", {"id": "m1", "message_sequence": 7})
    assert fresh.raw["blocks"][0]["transcript"] == "你好"


def test_dingtalk_quote_reply_records_the_quoted_message():
    run = FakeRun({"messages": [{"messageId": "m2", "createTime": "2026-11-10 15:53:56",
                                 "text": "引用测试", "quotedMessage": {"messageId": "m1", "text": "hi"}}]})
    [message], _ = DingTalkAdapter("dws", run).fetch("cid", None)
    assert message.reply_to == "m1"


def test_channel_edit_sends_the_revision_and_delete_confirms():
    run = FakeRun({"ok": True}, {"ok": True})
    adapter = ChannelAdapter("drlee", run=run)
    adapter.edit("ch", {"id": "m1", "revision": 3}, "改")
    adapter.retract("ch", {"id": "m1"})
    assert run.calls[0][-4:] == ["--if-revision", "3", "--text", "改"]
    assert run.calls[1][-3:] == ["ch", "m1", "--confirm"]


def test_refresh_picks_up_edits_and_deletes_but_not_read_counts(tmp_path):
    from deck.adapters.base import Conversation, Message
    from deck.store import Store
    s = Store(tmp_path / "deck.db")
    s.add_project("mx", "MX", None)
    cid = s.add_conversation("mx", Conversation("channel", "ch", "群"))
    at = datetime(2026, 11, 10, tzinfo=timezone.utc)
    msg = lambda text, **raw: Message("channel", "m1", "ch", "U", "张三", text, at, raw={"revision": 1, **raw})
    s.add_messages(cid, [msg("原文", read_count=1)], set())
    assert s.refresh(cid, [msg("原文", read_count=5)]) == 0
    assert s.refresh(cid, [msg("", deleted_at="2026-11-10T08:00:00Z")]) == 1
    s.close()


def test_channel_can_send_with_a_separate_drlee():
    run = FakeRun({"ok": True}, {"ok": True})
    adapter = ChannelAdapter("drlee", run=run, sender="drlee-old")
    adapter.send("ch", "你好")
    adapter.send("ch", "【MX 助手】你好", ai=True)
    assert [call[0] for call in run.calls] == ["drlee-old", "drlee"]


def test_chat_lists_and_ai_flags_are_parsed_per_platform():
    dingtalk = DingTalkAdapter("dws", run=FakeRun({"chats": [
        {"conversationType": "group", "openConversationId": "g1", "name": "群", "unreadPoint": 2},
        {"conversationType": "direct", "openConversationId": "d1", "name": "张三",
         "lastMsgCreateAt": "2026-11-09T12:00:56.305+08:00", "unreadPoint": 0}]}))
    group, direct = dingtalk.chats(set())
    assert (group.direct, group.unread, group.read_until) == (False, 2, None)
    assert (direct.direct, direct.conversation.name, direct.read_until) == (True, "张三", direct.last_at)
    # channel 私信的 name 是内部编号，取对方的名字。
    channel = ChannelAdapter("drlee", run=FakeRun({"data": [
        {"id": "c2", "type": "dm", "name": "dm-uuid", "last_message_created_at": None,
         "last_read_message_created_at": "2026-11-10T08:48:52Z",
         "member_previews": [{"id": "ME", "display_name": "我"}, {"id": "U2", "display_name": "李四"}]}]}))
    [dm] = channel.chats({"ME"})
    assert (dm.direct, dm.conversation.name, dm.read_until.isoformat()) == (True, "李四", "2026-11-10T08:48:52+00:00")

    base = {"id": "m", "created_at": "2026-11-10T08:48:52Z", "sender_kind": "user"}
    bots = [ChannelAdapter("drlee")._message("c", {**base, **extra}).bot for extra in (
        {}, {"sender_kind": "agent"}, {"blocks": [{"type": "ai_assisted", "automatic": True}]},
        {"blocks": [{"type": "ai_assisted"}]})]
    assert bots == [False, True, True, False]
    item = {"messageId": "m", "createTime": "2026-11-09 18:43:05", "messageAiSendFlag": "DWS"}
    assert DingTalkAdapter("dws")._message("c", item).bot
