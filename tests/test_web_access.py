"""网页接口：登录、设备、访问地址与端口。"""
import urllib.error
import urllib.request
from dataclasses import replace

import pytest
from web_support import Client

from deck import access
from deck import server as server_module
from deck.config import ServerConfig


def test_everything_but_login_needs_a_session(server, store):
    client = Client(server)
    assert client("GET", "/api/auth") == (200, {"authenticated": False, "password": False})
    status, body = client("GET", "/api/overview")
    assert status == 401 and body["auth"] is True
    status, page = 200, urllib.request.urlopen(f"http://127.0.0.1:{server}/").status
    assert page == 200  # 页面壳不含数据，不登录也给，好显示登录页
    assert client.login(store)[0] == 200
    assert "HttpOnly" in client.last_set_cookie and "SameSite=Strict" in client.last_set_cookie
    assert client("GET", "/api/auth") == (200, {"authenticated": True, "password": False})
    assert client("GET", "/api/overview")[0] == 200
    # 同主机其他服务的 Cookie 不规范，也不能把 deck 的登录弄丢。
    own = client.cookie
    client.cookie = f'theme={{"a":1}}; x=a b; a[b]=1; {own}'
    assert client("GET", "/api/auth")[1]["authenticated"]
    client.cookie = own
    assert client.login(store)[0] == 200 and client.cookie != own
    assert len(access.sessions(store)) == 1


def test_network_change_keeps_the_same_device_session(api, store):
    token = api.cookie.split("=", 1)[1]
    before = access.session_for(store, token, "10.49.36.141")
    after = access.session_for(store, token, "100.64.0.2")
    assert before is not None and after is not None and before["id"] == after["id"]
    assert len(access.sessions(store)) == 1


def test_entry_endpoints_require_auth_and_reject_untrusted_targets(server, store):
    client = Client(server)
    assert client("POST", "/api/access/entry", {"url": "http://evil.invalid/"}, {"X-Deck": "1"})[0] == 401
    client.login(store)
    assert client("POST", "/api/access/entry", {"url": "http://evil.invalid/"}, {"X-Deck": "1"})[0] == 400
    assert client("GET", "/api/access/entry-plan?url=http://evil.invalid/")[0] == 400


def test_local_password_works_only_for_direct_loopback(server, store):
    w = {"X-Deck": "1"}
    client = Client(server)
    assert client("POST", "/api/session", {"password": "whatever"}, w)[0] == 401
    with pytest.raises(ValueError):
        access.set_local_password(store, "12345")
    access.set_local_password(store, "s3cret-pass")
    assert "s3cret-pass" not in str(store.db.execute("SELECT value FROM settings").fetchall()[0][0])
    assert client("GET", "/api/auth")[1]["password"] is True
    assert client("POST", "/api/session", {"password": "wrong-pass"}, w)[0] == 401
    proxied = {**w, "X-Forwarded-For": "203.0.113.9"}
    assert client("GET", "/api/auth", headers=proxied)[1]["password"] is False
    assert client("POST", "/api/session", {"password": "s3cret-pass"}, proxied)[0] == 403
    relay = {**w, "Host": "deck.example.com"}
    assert client("POST", "/api/session", {"password": "s3cret-pass"}, relay)[0] == 403
    assert client("POST", "/api/session", {"password": "s3cret-pass"}, w)[0] == 200
    assert client("GET", "/api/overview")[0] == 200
    access.set_local_password(store, None)
    assert Client(server)("GET", "/api/auth")[1]["password"] is False


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
    assert all(s["origin"] == f"http://127.0.0.1:{api.port}" for s in body["sessions"])
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


def test_host_check_allows_configured_relay_only(api):
    assert api("GET", "/api/version", headers={"Host": "evil.example:80"})[0] == 403
    assert api("GET", "/api/version", headers={"Host": "deck.example.com"})[0] == 200


def test_lan_address_is_the_one_link_and_reports_tailscale_route(config, monkeypatch):
    lan = replace(config, server=replace(config.server, host="0.0.0.0", port=8765))
    monkeypatch.setattr(access, "local_interfaces", lambda: [
        ("100.112.181.122", "utun4"), ("10.49.36.140", "en0"), ("10.251.1.1", "utun0")])
    status = {"running": True, "phones": [], "phones_online": [], "routes": [], "advertised": []}
    monkeypatch.setattr(access, "tailscale_status", lambda: status)

    def primary(cfg=lan):
        found = [a for a in access.addresses(cfg) if a["recommended"]]
        assert len(found) == 1
        return found[0]

    assert primary()["url"] == "http://10.49.36.140:8765/"
    assert (primary()["remote"], primary()["route"]) == ("none", "10.49.36.140/32")
    status["advertised"] = ["10.49.36.140/32"]
    assert primary()["remote"] == "pending"
    status["routes"] = ["100.112.181.122/32", "10.49.36.0/24"]
    assert primary()["remote"] == "active"
    relay = replace(lan, server=replace(lan.server, public_urls=("https://deck.example.com",)))
    assert primary(relay)["kind"] == "relay"


def test_server_refuses_port_already_served_on_all_interfaces(config):
    import socket

    other = socket.socket()
    other.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    other.bind(("0.0.0.0", 0))
    other.listen()
    try:
        port = other.getsockname()[1]
        with pytest.raises(ValueError, match="已被占用"):
            server_module.make_server(replace(config, server=ServerConfig(host="127.0.0.1", port=port)), None)
    finally:
        other.close()
