from dataclasses import replace

import pytest

from deck import access
from deck import config as config_module
from deck.config import Config, ServerConfig
from deck.store import Store


def network(monkeypatch, ips=None):
    status = {"running": True, "phones": [], "phones_online": [], "routes": [],
              "advertised": ["192.168.50.0/24"]}
    monkeypatch.setattr(access, "local_interfaces", lambda: ips or [("10.49.36.140", "en0")])
    monkeypatch.setattr(access, "tailscale_status", lambda: status)
    return status


def test_fixed_entry_does_not_change_with_interface_order_or_phone_status(tmp_path, monkeypatch):
    network(monkeypatch)
    config = Config(home=tmp_path, server=ServerConfig(host="0.0.0.0"))
    assert hasattr(config.server, "entry_url")
    config = replace(config, server=replace(config.server, entry_url="http://10.49.36.140:8765/"))
    [primary] = [a for a in access.addresses(config) if a["recommended"]]
    assert primary["url"] == "http://10.49.36.140:8765/" and primary["pinned"]
    monkeypatch.setattr(access, "local_interfaces", lambda: [("192.168.1.8", "en0"), ("100.1.2.3", "utun1")])
    [changed] = [a for a in access.addresses(config) if a["recommended"]]
    assert changed["url"] == primary["url"] and not changed["usable"]
    assert "变化" in changed["status"]


def test_route_plan_preserves_other_routes_and_only_adds_this_host(tmp_path, monkeypatch):
    network(monkeypatch)
    config = Config(home=tmp_path, server=ServerConfig(host="0.0.0.0"))
    assert hasattr(access, "entry_plan")
    plan = access.entry_plan(config, "http://10.49.36.140:8765/")
    assert plan["advertise_routes"] == ["192.168.50.0/24", "10.49.36.140/32"]
    assert plan["previous_routes"] == ["192.168.50.0/24"]
    assert plan["remote"] == "none" and "--advertise-routes=192.168.50.0/24,10.49.36.140/32" in plan["command"]
    assert plan["warnings"] and plan["url"] == "http://10.49.36.140:8765/"


def test_configured_entry_is_shared_with_cli(tmp_path, monkeypatch):
    network(monkeypatch)
    config_module.init(tmp_path, None, None)
    store = Store(tmp_path / "deck.db")
    config = replace(config_module.load(tmp_path), server=ServerConfig(host="0.0.0.0"))
    assert hasattr(access, "pin_entry")
    access.pin_entry(store, config, "http://10.49.36.140:8765/")
    assert config_module.load(tmp_path).server.entry_url == "http://10.49.36.140:8765/"
    store.close()


@pytest.mark.parametrize("url", [
    "http://user:secret@10.49.36.140:8765/", "http://10.49.36.140:22/",
    "https://10.49.36.140:8765/", "http://10.49.36.140:8765/?code=secret",
    "http://10.49.36.140:8765/deck/", "http://192.168.8.1:8765/", "file:///tmp/test",
])
def test_entry_rejects_nonlocal_or_credential_urls(tmp_path, monkeypatch, url):
    network(monkeypatch)
    config = Config(home=tmp_path, server=ServerConfig(host="0.0.0.0"))
    with pytest.raises(ValueError) as error:
        access.entry_plan(config, url)
    assert "secret" not in str(error.value)


@pytest.mark.parametrize("unknown", [None, {"running": True, "advertised": [], "routes_known": False}])
def test_route_plan_never_overwrites_routes_when_existing_routes_are_unknown(tmp_path, monkeypatch, unknown):
    network(monkeypatch)
    monkeypatch.setattr(access, "tailscale_status", lambda: unknown)
    config = Config(home=tmp_path, server=ServerConfig(host="0.0.0.0"))
    plan = access.entry_plan(config, "http://10.49.36.140:8765/")
    assert not plan["routes_known"]
    assert plan["command"] is None and plan["rollback_command"] is None
    assert plan["previous_routes"] is None
    assert any("未知" in warning for warning in plan["warnings"])


def test_route_plan_does_not_duplicate_an_existing_covering_route(tmp_path, monkeypatch):
    status = network(monkeypatch)
    status["advertised"] = ["10.49.36.0/24"]
    status["routes"] = ["10.49.36.0/24"]
    config = Config(home=tmp_path, server=ServerConfig(host="0.0.0.0"))
    plan = access.entry_plan(config, "http://10.49.36.140:8765/")
    assert plan["advertise_routes"] == ["10.49.36.0/24"]
    assert plan["remote"] == "active"


def test_cli_setup_only_saves_entry_and_never_publishes_routes(tmp_path, monkeypatch, capsys):
    import json
    from deck import cli

    network(monkeypatch)
    monkeypatch.setenv("DECK_HOME", str(tmp_path))
    path = config_module.init(tmp_path, None, None)
    path.write_text(path.read_text().replace('host = "127.0.0.1"', 'host = "0.0.0.0"'))
    def forbid_network_writes(*args, **kwargs):
        raise AssertionError("预览和固定入口都不能执行网络命令")
    monkeypatch.setattr(access.subprocess, "run", forbid_network_writes)
    url = "http://10.49.36.140:8765/"
    assert cli.main(["--json", "access", "setup", url]) == 0
    assert not json.loads(capsys.readouterr().out)["saved"]
    assert config_module.load(tmp_path).server.entry_url == ""
    assert cli.main(["--json", "access", "setup", url, "--yes"]) == 0
    assert json.loads(capsys.readouterr().out)["saved"]
    assert config_module.load(tmp_path).server.entry_url == url


def test_missing_route_preferences_are_unknown_not_empty(monkeypatch):
    import json
    from types import SimpleNamespace

    monkeypatch.setattr(access, "_tailscale_cache", (0, None))
    monkeypatch.setattr(access.subprocess, "run", lambda argv, **_: SimpleNamespace(
        returncode=0, stdout=json.dumps({"BackendState": "Running", "Self": {}} if "status" in argv else {})))
    status = access.tailscale_status()
    assert status["running"] and not status["routes_known"]


def test_tailscale_stopped_is_not_reported_as_remote_ready(tmp_path, monkeypatch):
    status = network(monkeypatch)
    status.update(running=False, routes=["10.49.36.140/32"])
    assert access.route_state("10.49.36.140", status) != "active"
