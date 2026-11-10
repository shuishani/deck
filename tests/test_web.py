import io
import json
import threading
import time
import urllib.error
import urllib.request
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from deck import access
from deck import server as server_module
from deck.adapters.base import Conversation, Message
from deck.awaiting import awaiting
from deck.config import Config, ServerConfig
from deck.store import Store
from deck.sync import sync
from deck.watcher import Watcher

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)


def _msg(id, sender, text, minutes_ago, conversation="cid"):
    name = {"ME": "李涛", "BOT": "management-x-dev"}.get(sender, "张三")
    return Message("dingtalk", id, conversation, sender, name, text,
                   NOW - timedelta(minutes=minutes_ago))


class Adapter:
    source = "dingtalk"

    def __init__(self, messages):
        self.messages = messages

    def resolve(self, query):
        return Conversation("dingtalk", "cid", query)

    def fetch(self, conversation, cursor):
        return self.messages, "c"

    def send(self, conversation, text, reply_to=None):
        pass

    def self_ids(self, conversation):
        return {"ME"}


@pytest.fixture
def config(tmp_path):
    return Config(home=tmp_path, reply_reminder_hours=2, ignore_senders=("management-x-dev",),
                  ai_prefix="【MX 助手】")


@pytest.fixture
def store(config):
    s = Store(config.db_path)
    s.add_project("mx", "Management-X", None)
    s.add_conversation("mx", Conversation("dingtalk", "cid", "测试群"))
    yield s
    s.close()


def _fill(store, messages):
    sync(store, lambda _: Adapter(messages))


def test_awaiting_is_mentions_of_me_not_yet_answered(store, config):
    _fill(store, [
        _msg("old", "ME", "早上好", 300),
        _msg("q1", "OTHER", "@李涛 这个 bug 看下", 240),
        _msg("a1", "ME", "好的", 200),
        _msg("q2", "OTHER", "@李涛 部署了吗", 150),
        _msg("chat", "OTHER", "大家好", 100),
        _msg("bot", "BOT", "排版反馈已收到 @李涛", 90),
        _msg("q3", "OTHER", "@李涛 再看下", 30),
    ])
    items = awaiting(store, config, now=NOW)
    assert [a.message["remote_id"] for a in items] == ["q2", "q3"]
    assert [(a.waiting_minutes, a.overdue) for a in items] == [(150, True), (30, False)]


def test_awaiting_empty_until_we_know_my_name(store, config):
    _fill(store, [_msg("q", "OTHER", "@李涛 在吗", 10)])
    assert awaiting(store, config, now=NOW) == []


class FakeProc:
    def __init__(self, stdout_lines, stderr_lines):
        self.stdout = io.StringIO("".join(stdout_lines))
        self.stderr = io.StringIO("".join(stderr_lines))
        self.returncode = None

    def wait(self, timeout=None):
        self.returncode = 0
        return 0

    def poll(self):
        return self.returncode

    def terminate(self):
        self.returncode = -15


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


class Client:
    def __init__(self, port):
        self.port = port
        self.cookie = None

    def __call__(self, method, path, body=None, headers=None):
        headers = {"Content-Type": "application/json", **(headers or {})}
        if self.cookie:
            headers["Cookie"] = self.cookie
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}", method=method,
            data=json.dumps(body).encode() if body is not None else None, headers=headers,
        )
        try:
            with urllib.request.urlopen(request) as response:
                self._remember(response.headers)
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def _remember(self, headers):
        for value in headers.get_all("Set-Cookie") or []:
            self.last_set_cookie = value
            pair = value.split(";")[0]
            self.cookie = None if pair.endswith("=") else pair

    def login(self, store):
        code, _ = access.create_pairing(store)
        return self("POST", "/api/session", {"code": code}, {"X-Deck": "1"})


@pytest.fixture
def server(config, store, monkeypatch):
    _fill(store, [_msg("me", "ME", "你好", 60), _msg("q", "OTHER", "@李涛 看下", 10)])
    monkeypatch.setattr(server_module, "adapter_for", lambda source, config: Adapter([]))
    config = replace(config, server=ServerConfig(port=0, allowed_hosts=("deck.example.com",)))
    httpd = server_module.make_server(config, None)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


@pytest.fixture
def api(server, store):
    client = Client(server)
    assert client.login(store)[0] == 200
    return client


def test_everything_but_login_needs_a_session(server, store):
    client = Client(server)
    assert client("GET", "/api/auth") == (200, {"authenticated": False})
    status, body = client("GET", "/api/overview")
    assert status == 401 and body["auth"] is True
    status, page = 200, urllib.request.urlopen(f"http://127.0.0.1:{server}/").status
    assert page == 200  # 页面壳不含数据，不登录也给，好显示登录页
    assert client.login(store)[0] == 200
    assert "HttpOnly" in client.last_set_cookie and "SameSite=Strict" in client.last_set_cookie
    assert client("GET", "/api/auth") == (200, {"authenticated": True})
    assert client("GET", "/api/overview")[0] == 200


def test_login_code_is_single_use_and_bad_codes_are_limited(server, store):
    code, _ = access.create_pairing(store)
    first, second = Client(server), Client(server)
    assert first("POST", "/api/session", {"code": code.lower()}, {"X-Deck": "1"})[0] == 200
    assert second("POST", "/api/session", {"code": code}, {"X-Deck": "1"})[0] == 401
    statuses = [second("POST", "/api/session", {"code": "WRONGCODE1"}, {"X-Deck": "1"})[0]
                for _ in range(11)]
    assert statuses[:9] == [401] * 9 and statuses[-1] == 429


def test_logout_and_revoke_devices(api, store):
    other = Client(api.port)
    other.login(store)
    _, body = api("GET", "/api/access")
    assert len(body["sessions"]) == 2
    assert [s["current"] for s in body["sessions"]].count(True) == 1
    assert body["addresses"][0]["url"].startswith("http://127.0.0.1:")
    other_id = next(s["id"] for s in body["sessions"] if not s["current"])
    assert api("DELETE", f"/api/sessions/{other_id}", headers={"X-Deck": "1"})[0] == 200
    assert other("GET", "/api/overview")[0] == 401
    assert api("DELETE", "/api/session", headers={"X-Deck": "1"})[0] == 200
    assert api.cookie is None


def test_disable_keeps_the_device_but_shuts_it_out_until_enabled(api, store):
    phone = Client(api.port)
    phone.login(store)
    _, body = api("GET", "/api/access")
    me = next(s["id"] for s in body["sessions"] if s["current"])
    other = next(s["id"] for s in body["sessions"] if not s["current"])
    assert api("POST", f"/api/sessions/{me}/disable", headers={"X-Deck": "1"})[0] == 400
    assert api("POST", f"/api/sessions/{other}/disable", headers={"X-Deck": "1"})[0] == 200
    assert phone("GET", "/api/overview")[0] == 401
    _, body = api("GET", "/api/access")
    assert next(s for s in body["sessions"] if s["id"] == other)["disabled_at"]
    assert api("POST", f"/api/sessions/{other}/enable", headers={"X-Deck": "1"})[0] == 200
    assert phone("GET", "/api/overview")[0] == 200


def test_pairing_from_a_logged_in_device(api, server):
    _, body = api("POST", "/api/pairings", headers={"X-Deck": "1"})
    phone = Client(server)
    assert phone("POST", "/api/session", {"code": body["code"]}, {"X-Deck": "1"})[0] == 200


def test_works_under_a_relay_sub_path(api, server):
    assert api("GET", "/deck/api/version")[0] == 200
    with urllib.request.urlopen(f"http://127.0.0.1:{server}/deck/") as page:
        assert page.status == 200


def test_overview_counts_and_awaiting(api):
    status, body = api("GET", "/api/overview")
    assert status == 200
    [group] = body["projects"][0]["groups"]
    assert group["awaiting_count"] == 1
    assert group["last_message"]["text"] == "@李涛 看下"
    assert group["watch"]["mode"] == "poll"


def test_timeline_marks_awaiting_and_pages(api):
    _, body = api("GET", "/api/timeline?limit=1")
    assert [m["text"] for m in body["messages"]] == ["@李涛 看下"]
    assert body["messages"][0]["awaiting"] and body["has_more"]
    _, older = api("GET", f"/api/timeline?limit=5&before={body['messages'][0]['id']}")
    assert [m["text"] for m in older["messages"]] == ["你好"]
    assert not older["has_more"]


def test_writes_need_header_and_send_previews_first(api):
    status, _ = api("POST", "/api/send", {"group": 1, "text": "收到"})
    assert status == 403
    status, body = api("POST", "/api/send", {"group": 1, "text": "收到", "ai": True},
                       {"X-Deck": "1"})
    assert status == 200 and body["preview"]["text"] == "【MX 助手】收到"
    status, body = api("POST", "/api/send", {"group": 1, "text": "收到", "confirm": True},
                       {"X-Deck": "1"})
    assert status == 200 and body == {"sent": True}


def test_host_check_allows_configured_relay_only(api):
    assert api("GET", "/api/version", headers={"Host": "evil.example:80"})[0] == 403
    assert api("GET", "/api/version", headers={"Host": "deck.example.com"})[0] == 200
