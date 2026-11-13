"""网页接口：发送、编辑撤回、附件与平台状态。"""
import json
import threading
import urllib.error
import urllib.request

from web_support import Adapter, Client, _msg

from deck import actions as actions_module
from deck import api as api_module


def test_source_health_is_local_cached_and_never_exposes_credentials(api, monkeypatch):
    import shutil
    import subprocess
    from types import SimpleNamespace

    calls = []
    monkeypatch.setattr(shutil, "which", lambda path: f"/tools/{path}")

    def run(argv, **kwargs):
        calls.append(argv)
        if "--version" in argv:
            return SimpleNamespace(returncode=0, stdout="cli 1.2.3", stderr="")
        data = ({"user_id": "u1", "user_name": "测试账号", "access_token": "NEVER_RETURN"}
                if "dws" in argv[0] else
                {"type": "completed", "data": {"items": [{"current": True, "email": "test@example.invalid", "access_expires_at": 2000000000,
                            "credential_state": "valid", "refresh_token": "NEVER_RETURN"}]}})
        return SimpleNamespace(returncode=0, stdout=json.dumps(data), stderr="")

    monkeypatch.setattr(subprocess, "run", run)
    status, body = api("GET", "/api/sources")
    assert status == 200
    first, second = body["sources"]
    assert first["health"]["account"] == "测试账号"
    assert first["health"]["expires_at"] is None
    assert first["health"]["version"] == "cli 1.2.3"
    assert second["health"]["account"] == "test@example.invalid"
    assert second["health"]["expires_at"] is not None
    assert "NEVER_RETURN" not in json.dumps(body)
    api("GET", "/api/sources")
    assert len(calls) == 4
    assert any(argv[-2:] == ["auth", "list"] for argv in calls)


def test_source_health_recognizes_reauthentication_without_guessing(api, monkeypatch):
    import shutil
    import subprocess
    from types import SimpleNamespace

    monkeypatch.setattr(shutil, "which", lambda path: f"/tools/{path}")

    def run(argv, **kwargs):
        if "--version" in argv:
            return SimpleNamespace(returncode=0, stdout="cli 1", stderr="")
        data = ({"user_id": "me"} if "dws" in argv[0] else
                {"type": "completed", "data": {"items": [{"current": True, "email": "test@example.invalid",
                           "credential_state": "reauthentication_required"}]}})
        return SimpleNamespace(returncode=0, stdout=json.dumps(data), stderr="")

    monkeypatch.setattr(subprocess, "run", run)
    sources = api("GET", "/api/sources")[1]["sources"]
    assert sources[1]["health"]["auth_state"] == "needs_login"


def test_source_health_missing_tool_is_not_healthy(api, monkeypatch):
    import shutil

    monkeypatch.setattr(shutil, "which", lambda _: None)
    _, body = api("GET", "/api/sources")
    assert all(s["health"]["available"] is False for s in body["sources"])
    assert all(s["health"]["auth_state"] == "unknown" for s in body["sources"])


def test_send_operation_retries_do_not_duplicate_and_report_readback_failure(api, monkeypatch):
    from deck.runner import ToolError

    class Sender(Adapter):
        sent = 0

        def send(self, *args, **kwargs):
            Sender.sent += 1

        def fetch(self, *args):
            raise ToolError("回读断线")

    monkeypatch.setattr(api_module, "adapter_for", lambda *_: Sender([]))
    w = {"X-Deck": "1"}
    _, body = api("POST", "/api/send", {"group": 1, "text": "收到"}, w)
    operation = body["preview"]["operation_id"]
    request = {"operation_id": operation, "confirm": True}
    status, sent = api("POST", "/api/send", request, w)
    assert status == 200 and sent["status"] == "sent" and sent["sent"]
    assert sent["message_id"] is None and sent["sync_error"]
    assert api("POST", "/api/send", request, w)[1] == sent
    assert Sender.sent == 1


def test_concurrent_confirmations_claim_only_one_platform_send(api, server, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    entered, release = threading.Event(), threading.Event()

    class Sender(Adapter):
        sent = 0

        def send(self, *args, **kwargs):
            Sender.sent += 1
            entered.set()
            assert release.wait(5)

    monkeypatch.setattr(api_module, "adapter_for", lambda *_: Sender([]))
    w = {"X-Deck": "1"}
    _, body = api("POST", "/api/send", {"group": 1, "text": "并发确认"}, w)
    request = {"operation_id": body["preview"]["operation_id"], "confirm": True}
    second = Client(server)
    second.cookie = api.cookie
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(api, "POST", "/api/send", request, w)
        try:
            assert entered.wait(3)
            status, duplicate = second("POST", "/api/send", request, w)
            assert status == 200 and duplicate["status"] == "sending"
        finally:
            release.set()
        assert first.result(timeout=5)[1]["sent"]
    assert Sender.sent == 1


def test_send_confirmation_is_bound_to_preview_and_device(api, server, store):
    w = {"X-Deck": "1"}
    _, body = api("POST", "/api/send", {"group": 1, "text": "原内容"}, w)
    operation = body["preview"]["operation_id"]
    assert api("POST", "/api/send", {"operation_id": operation, "confirm": True, "text": "篡改"}, w)[0] == 400
    other = Client(server)
    other.login(store)
    assert other("POST", "/api/send", {"operation_id": operation, "confirm": True}, w)[0] == 404
    assert api("POST", "/api/send", {"group": 1, "text": "绕过预览", "confirm": True}, w)[0] == 400
    store.db.execute("UPDATE send_operations SET expires_at = '2000-01-01T00:00:00+00:00'")
    store.db.commit()
    assert api("POST", "/api/send", {"operation_id": operation, "confirm": True}, w)[0] == 400


def test_uncertain_send_is_recorded_and_never_automatically_retried(api, monkeypatch):
    from deck.runner import ToolError

    class Uncertain(Adapter):
        sent = 0

        def send(self, *args, **kwargs):
            Uncertain.sent += 1
            raise ToolError("请求超时")

    monkeypatch.setattr(api_module, "adapter_for", lambda *_: Uncertain([]))
    w = {"X-Deck": "1"}
    _, body = api("POST", "/api/send", {"group": 1, "text": "收到"}, w)
    request = {"operation_id": body["preview"]["operation_id"], "confirm": True}
    _, result = api("POST", "/api/send", request, w)
    assert result["status"] == "unknown" and not result["sent"] and result["error"]
    assert api("POST", "/api/send", request, w)[1] == result
    assert Uncertain.sent == 1


def test_send_operation_returns_the_read_back_message(api, monkeypatch):
    class Sender(Adapter):
        def send(self, conversation, text, reply_to=None, ai=False):
            self.messages.append(_msg("sent-new", "ME", text, 0))

    sender = Sender([])
    monkeypatch.setattr(api_module, "adapter_for", lambda *_: sender)
    w = {"X-Deck": "1"}
    _, body = api("POST", "/api/send", {"group": 1, "text": "新的回复", "handle": 2}, w)
    _, result = api("POST", "/api/send", {"operation_id": body["preview"]["operation_id"], "confirm": True}, w)
    assert result["sent"] and result["message_id"] is not None and result["sync_error"] is None
    messages = api("GET", "/api/timeline")[1]["messages"]
    assert next(m for m in messages if m["id"] == result["message_id"])["text"] == "新的回复"
    assert next(m for m in messages if m["id"] == 2)["handled"]


def test_upload_http_is_binary_local_and_owner_scoped(api, server, store):
    request = urllib.request.Request(f'http://127.0.0.1:{server}/api/uploads?group=1&name=note.txt',
        method='POST', data=b'local-only-content', headers={'Cookie': api.cookie, 'X-Deck': '1', 'Content-Type': 'text/plain'})
    with urllib.request.urlopen(request) as response:
        upload = json.load(response)['attachment']
    assert 'path' not in upload and upload['name'] == 'note.txt'
    request = urllib.request.Request(f'http://127.0.0.1:{server}/api/uploads/{upload["id"]}', headers={'Cookie': api.cookie})
    with urllib.request.urlopen(request) as response:
        assert response.read() == b'local-only-content'
        assert 'attachment' in response.headers['Content-Disposition']
    other = Client(server)
    other.login(store)
    assert other('GET', f'/api/uploads/{upload["id"]}')[0] == 404
    status, preview = api('POST', '/api/send', {'group': 1, 'text': '', 'ai': False, 'attachments': [upload['id']]}, {'X-Deck': '1'})
    assert status == 200 and preview['preview']['attachments'] == [upload]
    assert api('GET', '/api/capabilities')[1]['sources']['dingtalk']['reply_attachments'] is False


def test_writes_need_header_and_send_previews_first(api, monkeypatch):
    status, _ = api("POST", "/api/send", {"group": 1, "text": "收到"})
    assert status == 403
    status, body = api("POST", "/api/send", {"group": 1, "text": "收到", "ai": True},
                       {"X-Deck": "1"})
    # 钉钉自己会标「通过 AI 发送」，不再加文字前缀。
    assert status == 200 and body["preview"]["text"] == "收到"
    monkeypatch.setattr(actions_module, "MARKS_AI", set())
    _, body = api("POST", "/api/send", {"group": 1, "text": "收到", "ai": True}, {"X-Deck": "1"})
    assert body["preview"]["text"] == "【MX 助手】收到"
    operation = body["preview"]["operation_id"]
    status, body = api("POST", "/api/send", {"operation_id": operation, "confirm": True},
                       {"X-Deck": "1"})
    assert status == 200 and body["sent"] and body["status"] == "sent"


def test_media_is_downloaded_once_and_served_safely(api, store, monkeypatch):
    raw = {"channel_id": "ch", "files": [
        {"id": "f1", "filename": "a.jpg", "mime_type": "image/jpeg", "file_size": 4},
        {"id": "f2", "filename": "page.html", "mime_type": "text/html", "file_size": 4}]}
    store.db.execute("UPDATE messages SET raw = ? WHERE remote_id = 'q'", (json.dumps(raw),))
    store.db.execute("UPDATE conversations SET source = 'channel'")
    store.db.commit()
    id = store.db.execute("SELECT id FROM messages WHERE remote_id = 'q'").fetchone()[0]
    calls = []

    class Downloader(Adapter):
        def download(self, ref, stem):
            calls.append(ref["file_id"])
            body = b"\xff\xd8\xff\xe0" if ref["file_id"] == "f1" else b"<script>"
            path = stem.with_suffix(".jpg" if ref["file_id"] == "f1" else ".html")
            path.write_bytes(body)
            return path

    monkeypatch.setattr(api_module, "adapter_for", lambda source, config: Downloader([]))
    url = f"http://127.0.0.1:{api.port}/api/media/{id}/"
    for _ in range(2):
        request = urllib.request.Request(url + "0", headers={"Cookie": api.cookie})
        with urllib.request.urlopen(request) as response:
            assert response.headers["Content-Type"] == "image/jpeg"
            assert response.headers["Content-Disposition"].startswith("inline")
            assert response.read() == b"\xff\xd8\xff\xe0"
    assert calls == ["f1"]
    request = urllib.request.Request(url + "1", headers={"Cookie": api.cookie, "Range": "bytes=1-"})
    with urllib.request.urlopen(request) as response:
        assert response.status == 206
        assert response.headers["Content-Type"] == "application/octet-stream"
        assert response.headers["Content-Disposition"].startswith("attachment")
        assert response.read() == b"script>"
    assert api("GET", f"/api/media/{id}/5")[0] == 404
    assert Client(api.port)("GET", f"/api/media/{id}/0")[0] == 401
    store.prune(0)
    assert not list(store.media_dir.iterdir())


def test_channel_reply_goes_to_the_thread_root(api, store):
    store.db.execute("UPDATE conversations SET source = 'channel'")
    store.db.execute("UPDATE messages SET reply_to = 'me' WHERE remote_id = 'q'")
    store.db.commit()
    _, body = api("POST", "/api/send", {"group": 1, "text": "收到", "reply_to": "q"}, {"X-Deck": "1"})
    assert body["preview"]["reply_to"] == "me"
    _, body = api("POST", "/api/send", {"group": 1, "text": "收到", "reply_to": "me"}, {"X-Deck": "1"})
    assert body["preview"]["reply_to"] == "me"


def test_replies_carry_a_quote_of_the_original(api, store):
    store.db.execute("UPDATE messages SET reply_to = 'me' WHERE remote_id = 'q'")
    store.db.commit()
    reply = next(m for m in api("GET", "/api/timeline")[1]["messages"] if m["remote_id"] == "q")
    assert reply["quote"] == {"found": True, "id": reply["id"] - 1, "sender_name": "李涛",
                              "is_me": True, "text": "你好"}


def test_edit_and_retract_own_messages_only(api, store, monkeypatch):
    calls = []

    class Editor(Adapter):
        def edit(self, conversation, raw, text):
            calls.append(("edit", text))

        def retract(self, conversation, raw):
            calls.append(("retract",))

        def refetch(self, conversation, raw):
            return None

    monkeypatch.setattr(api_module, "adapter_for", lambda source, config: Editor([]))
    w = {"X-Deck": "1"}
    mine = store.db.execute("SELECT id FROM messages WHERE remote_id = 'me'").fetchone()[0]
    other = store.db.execute("SELECT id FROM messages WHERE remote_id = 'q'").fetchone()[0]
    assert api("POST", f"/api/messages/{other}/edit", {"text": "x", "confirm": True}, w)[0] == 400
    _, body = api("POST", f"/api/messages/{mine}/edit", {"text": "你好呀"}, w)
    assert body["preview"]["text"] == "你好呀" and calls == []
    assert api("POST", f"/api/messages/{mine}/edit", {"text": "你好呀", "confirm": True}, w)[0] == 200
    message = next(m for m in api("GET", "/api/timeline")[1]["messages"] if m["id"] == mine)
    assert (message["text"], message["edited"]) == ("你好呀", True)
    _, body = api("POST", f"/api/messages/{mine}/retract", {}, w)
    assert body["preview"]["text"] == "你好呀" and len(calls) == 1
    assert api("POST", f"/api/messages/{mine}/retract", {"confirm": True}, w)[0] == 200
    message = next(m for m in api("GET", "/api/timeline")[1]["messages"] if m["id"] == mine)
    assert message["retracted"] and message["text"] == ""
    assert api("POST", f"/api/messages/{mine}/retract", {"confirm": True}, w)[0] == 400
    assert calls == [("edit", "你好呀"), ("retract",)]
