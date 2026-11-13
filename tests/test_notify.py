import io
import json
import urllib.parse

import pytest

from deck import notify


@pytest.fixture
def keys(monkeypatch):
    saved = {}
    monkeypatch.setattr("deck.keychain.read", lambda item: saved.get(item, ""))
    monkeypatch.setattr("deck.keychain.write", saved.__setitem__)
    return saved


def test_settings_merge_and_validate(store, keys):
    values = notify.settings(store)
    assert values["levels"]["urgent"] == {"work": 15, "off": 30} and not values["webhook"]
    values = notify.configure(store, {"levels": {"high": {"work": 120}}, "digest_time": "08:00"})
    assert values["levels"]["high"] == {"work": 120, "off": None} and values["levels"]["urgent"]["work"] == 15
    for bad in ({"levels": {"huge": {}}}, {"levels": {"high": {"work": -1}}}, {"digest_time": "8:00"},
                {"work_start": "19:00"}, {"work_days": [0]}, {"enabled": "yes"}, {"webhook": "x"}):
        with pytest.raises(ValueError):
            notify.configure(store, bad)


def test_webhook_lives_in_keychain_and_send_is_signed(store, keys, monkeypatch):
    with pytest.raises(ValueError, match="Webhook"):
        notify.set_webhook(store, "https://evil.example/robot", "")
    url = "https://oapi.dingtalk.com/robot/send?access_token=abc123"
    assert notify.set_webhook(store, url, "SEC" + "0" * 24)["signed"]
    assert keys == {notify.WEBHOOK_ITEM: url, notify.SECRET_ITEM: "SEC" + "0" * 24}
    sent = []

    def urlopen(request, timeout):
        sent.append(request)
        return io.BytesIO(json.dumps({"errcode": 0}).encode())
    monkeypatch.setattr("urllib.request.urlopen", urlopen)
    notify.test(store)
    query = urllib.parse.parse_qs(urllib.parse.urlparse(sent[0].full_url).query)
    assert query["access_token"] == ["abc123"] and query["timestamp"] and query["sign"]
    assert json.loads(sent[0].data)["msgtype"] == "markdown"
    monkeypatch.setattr("urllib.request.urlopen", lambda *_, **__: io.BytesIO(b'{"errcode": 310000, "errmsg": "sign"}'))
    with pytest.raises(ValueError, match="sign"):
        notify.test(store)
    assert "SEC" not in json.dumps([dict(r) for r in store.db.execute("SELECT detail FROM audit")])
