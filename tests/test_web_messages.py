"""网页接口：消息、群、提醒规则与待处理。"""
import threading
import time
from dataclasses import replace
from datetime import datetime

import pytest
from web_support import NOW, FakeProc, _fill, _msg

from deck.attention import attention
from deck.sync import sync
from deck.watcher import Watcher


def test_retention_setting_does_not_hide_stored_unhandled_mentions(api, config, store):
    _fill(store, [_msg("still-waiting", "OTHER", "@李涛 两天前的问题", 60 * 48)])
    before = [a.message["remote_id"] for a in attention(store, config, now=NOW)]
    assert "still-waiting" in before
    assert api("POST", "/api/config", {"retention_days": 1}, {"X-Deck": "1"})[0] == 200
    messages = api("GET", "/api/attention")[1]["messages"]
    assert any(m["remote_id"] == "still-waiting" for m in messages)
    assert store.message_by_remote(1, "still-waiting") is not None


def test_search_http_finds_old_messages_and_timeline_around(api, store):
    _fill(store, [_msg(f'search-{i}', 'OTHER', '旧的唯一搜索词' if i == 0 else f'后来消息{i}', 500-i) for i in range(230)])
    _, result = api('GET', '/api/search?q=%E6%97%A7%E7%9A%84%E5%94%AF%E4%B8%80%E6%90%9C%E7%B4%A2%E8%AF%8D')
    assert len(result['hits']) == 1
    hit = result['hits'][0]['message']
    status, around = api('GET', f'/api/timeline?group=1&around={hit["id"]}')
    assert status == 200 and any(m['id'] == hit['id'] for m in around['messages'])


@pytest.mark.parametrize("hour, minute, muted", [(21, 59, False), (22, 0, True), (1, 0, True), (6, 0, False)])
def test_quiet_hours_cross_midnight_using_server_local_time(hour, minute, muted):
    from deck import rules

    now = datetime.now().astimezone().replace(hour=hour, minute=minute)
    rule = rules.validate({"quiet_start": "22:00", "quiet_end": "06:00"})
    assert rules.quiet(rule, now) is muted


def test_group_rules_only_filter_attention_not_messages(api, store, config):
    _fill(store, [_msg("mention", "OTHER", "@李涛 看下", 10),
                  _msg("issue", "OTHER", "上传失败", 9)])
    w = {"X-Deck": "1"}
    rules = {"scope": "mentions", "keywords": [], "quiet_start": None, "quiet_end": None}
    assert api("POST", "/api/groups/1/rules", rules, w)[0] == 200
    assert len(attention(store, config, now=NOW)) == 2
    assert len(store.timeline()) == 4
    assert api("GET", "/api/groups")[1]["groups"][0]["rules"] == rules
    rules.update(scope="keywords", keywords=["上传"])
    assert api("POST", "/api/groups/1/rules", rules, w)[0] == 200
    assert [a.message["text"] for a in attention(store, config, now=NOW)] == ["上传失败"]
    # 全天免打扰不代表处理完成，恢复后仍能查看。
    rules.update(quiet_start="00:00", quiet_end="00:00")
    assert api("POST", "/api/groups/1/rules", rules, w)[0] == 200
    assert attention(store, config, now=NOW) == []
    rules.update(quiet_start=None, quiet_end=None, scope="all")
    api("POST", "/api/groups/1/rules", rules, w)
    assert len(attention(store, config, now=NOW)) == 3


@pytest.mark.parametrize("rules", [
    {"scope": "bad"}, {"scope": "keywords", "keywords": []},
    {"quiet_start": "25:00", "quiet_end": "06:00"},
    {"quiet_start": "22:00"}, {"keywords": "bug"},
])
def test_group_rules_reject_invalid_values(api, rules):
    assert api("POST", "/api/groups/1/rules", rules, {"X-Deck": "1"})[0] == 400


def test_attention_mentions_and_issues_until_handled(store, config):
    _fill(store, [
        _msg("old", "ME", "早上好", 300),
        _msg("q1", "OTHER", "@李涛 这个看下", 240),
        _msg("a1", "ME", "好的", 200),
        _msg("chat", "OTHER", "大家好", 100),
        _msg("bug", "OTHER", "上传一直失败，怎么回事", 95),
        _msg("bot", "BOT", "排版反馈已收到 @李涛 失败", 90),
        _msg("q3", "OTHER", "@李涛 再看下", 30),
    ])
    items = attention(store, config, now=NOW)
    # 我之后说过话不算处理：没引用回复、没标记，就还在。
    assert [(a.message["remote_id"], a.reason) for a in items] == [
        ("q1", "mention"), ("bug", "issue"), ("q3", "mention")]
    assert [a.overdue for a in items] == [True, False, False]
    store.set_handled(items[0].message["id"], True)
    assert [a.message["remote_id"] for a in attention(store, config, now=NOW)] == ["bug", "q3"]


def test_quote_reply_clears_and_replies_to_me_count(store, config):
    _fill(store, [
        _msg("q", "OTHER", "@李涛 在吗", 50),
        replace(_msg("r", "ME", "在", 40), reply_to="q"),
        replace(_msg("to-me", "OTHER", "收到你的消息了", 30), reply_to="r"),
    ])
    assert [a.message["remote_id"] for a in attention(store, config, now=NOW)] == ["to-me"]


def test_old_issues_drop_out(store, config):
    _fill(store, [_msg("bug", "OTHER", "页面白屏了", 60 * 24 * 4)])
    assert attention(store, config, now=NOW) == []


def test_listener_event_triggers_sync_of_that_group(store, config):
    synced = []
    started = threading.Event()

    def popen(argv, **_):
        assert argv[1:4] == ["event", "+listen-im", "--kind"]
        assert argv[argv.index("--chat-id") + 1] == "cid"
        started.set()
        return FakeProc(['{"type":"user_im_message_receive_group"}\n'],
                        ["[event] ready event_count=1\n"])

    watcher = Watcher(config, sync_one=synced.append, popen=popen)
    watcher.start()
    try:
        assert started.wait(5)
        deadline = time.monotonic() + 5
        while (synced.count(1) < 2 or not watcher.status(1)[1]) and time.monotonic() < deadline:
            time.sleep(0.05)
        mode, error = watcher.status(1)
    finally:
        watcher.stop()
    # 一次是首轮轮询，一次是监听到事件；进程退出后退回轮询并给出原因。
    assert synced.count(1) >= 2
    assert mode == "poll" and "监听断开" in error


def test_overview_counts_and_awaiting(api):
    status, body = api("GET", "/api/overview")
    assert status == 200
    [group] = body["projects"][0]["groups"]
    assert group["awaiting_count"] == 1 and group["issue_count"] == 0
    # 加群之前的消息不算未读。
    assert group["unread_count"] == 0
    assert group["last_message"]["text"] == "@李涛 看下"
    assert group["watch"]["mode"] == "poll"


def test_timeline_marks_awaiting_and_pages(api):
    _, body = api("GET", "/api/timeline?limit=1")
    assert [m["text"] for m in body["messages"]] == ["@李涛 看下"]
    assert body["messages"][0]["attention"] == "mention" and body["has_more"]
    _, older = api("GET", f"/api/timeline?limit=5&before={body['messages'][0]['id']}")
    assert [m["text"] for m in older["messages"]] == ["你好"]
    assert not older["has_more"]


def test_group_kind_is_guessed_then_settable(api):
    [group] = api("GET", "/api/groups")[1]["groups"]
    assert group["kind"] == "test"  # 群名「测试群」
    w = {"X-Deck": "1"}
    assert api("POST", f"/api/groups/{group['id']}/kind", {"kind": "prod"}, w)[1]["kind"] == "prod"
    _, body = api("POST", "/api/send", {"group": group["id"], "text": "收到"}, w)
    assert body["preview"]["kind"] == "prod"
    assert api("POST", f"/api/groups/{group['id']}/kind", {"kind": "formal"}, w)[0] == 400


def test_read_and_handled(api, store):
    w = {"X-Deck": "1"}
    store.db.execute("UPDATE conversations SET read_at = ''")
    store.db.commit()
    [group] = api("GET", "/api/overview")[1]["projects"][0]["groups"]
    assert group["unread_count"] == 1  # 别人发的那条；我自己的不算
    assert api("POST", "/api/groups/1/read", headers=w)[0] == 200
    [group] = api("GET", "/api/overview")[1]["projects"][0]["groups"]
    assert group["unread_count"] == 0
    [item] = api("GET", "/api/attention")[1]["messages"]
    assert item["attention"] == "mention"
    assert api("POST", f"/api/messages/{item['id']}/handled", {"handled": True}, w)[0] == 200
    assert api("GET", "/api/attention")[1]["messages"] == []
    timeline = api("GET", "/api/timeline")[1]["messages"]
    assert [m["handled"] for m in timeline] == [False, True]
    assert api("POST", f"/api/messages/{item['id']}/handled", {"handled": False}, w)[0] == 200
    assert len(api("GET", "/api/attention")[1]["messages"]) == 1
    assert api("POST", "/api/messages/999/handled", {}, w)[0] == 400


def test_paused_source_is_neither_listened_nor_polled(store, config):
    store.set_source_paused("dingtalk", True)
    synced, started = [], []
    watcher = Watcher(config, sync_one=synced.append, popen=lambda argv, **_: started.append(argv))
    watcher.start()
    time.sleep(0.3)
    watcher.stop()
    assert synced == [] and started == []
    assert sync(store, lambda _: None) == []


def test_pause_and_resume_a_source(api):
    w = {"X-Deck": "1"}
    assert len(api("POST", "/api/sync", {"source": "dingtalk"}, w)[1]["results"]) == 1
    assert api("POST", "/api/sync", {"source": "channel"}, w)[1]["results"] == []
    assert api("POST", "/api/sources/dingtalk/paused", {"paused": True}, w)[0] == 200
    assert api("POST", "/api/sync", {"source": "dingtalk"}, w)[0] == 409
    source = next(s for s in api("GET", "/api/sources")[1]["sources"] if s["source"] == "dingtalk")
    assert source["paused"] is True and "auth_state" in source["health"]
    [group] = api("GET", "/api/overview")[1]["projects"][0]["groups"]
    assert group["watch"] == {**group["watch"], "mode": "paused", "error": None}
    api("POST", "/api/sources/dingtalk/paused", {"paused": False}, w)
    source = next(s for s in api("GET", "/api/sources")[1]["sources"] if s["source"] == "dingtalk")
    assert source["paused"] is False and "auth_state" in source["health"]
    assert api("POST", "/api/sources/feishu/paused", {"paused": True}, w)[0] == 400
