import threading
from dataclasses import replace

import pytest
from web_support import Adapter, Client, _fill, _msg

from deck import api as api_module
from deck import server as server_module
from deck.adapters.base import Conversation
from deck.config import Config, ServerConfig
from deck.store import Store


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


@pytest.fixture
def server(config, store, monkeypatch):
    _fill(store, [_msg("me", "ME", "你好", 60), _msg("q", "OTHER", "@李涛 看下", 10)])
    monkeypatch.setattr(api_module, "adapter_for", lambda source, config: Adapter([]))
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
    # 非默认端口用带端口的 Cookie 名，不顶掉同机正式看板（8765）的登录。
    assert client.cookie.startswith("deck_session_0=")
    return client
