import io
import json

import pytest
from web_support import Adapter, _fill, _msg

from deck import api as api_module
from deck import mcp
from deck.store import Store


@pytest.fixture
def server(config, store, monkeypatch):
    _fill(store, [_msg("me", "ME", "你好", 60), _msg("q", "OTHER", "@李涛 看下", 10)])
    calls = []

    class Platform(Adapter):
        def send(self, conversation, text, reply_to=None, ai=False):
            calls.append(("send", text))

        def retract(self, conversation, raw):
            calls.append(("retract",))

    monkeypatch.setattr(api_module, "adapter_for", lambda source, config: Platform([]))
    s = Store(config.db_path, via="mcp")
    server = mcp.Server(s, config)
    server.calls = calls
    yield server
    s.close()


def call(server, name, **args):
    result = server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                            "params": {"name": name, "arguments": args}})["result"]
    text = result["content"][0]["text"]
    return result["isError"], text if result["isError"] else json.loads(text)


def test_protocol_and_conservative_tool_set(server):
    lines = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
             {"jsonrpc": "2.0", "method": "notifications/initialized"},
             {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
             {"jsonrpc": "2.0", "id": 3, "method": "ping"},
             {"jsonrpc": "2.0", "id": 4, "method": "resources/list"},
             {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "groups_remove"}}]
    stdin = io.BytesIO(b"".join(json.dumps(m).encode() + b"\n" for m in lines) + b"\n{oops\n")
    stdout = io.BytesIO()
    mcp.run(server, stdin, stdout)
    replies = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert [r["id"] for r in replies] == [1, 2, 3, 4, 5, None]
    assert replies[0]["result"]["protocolVersion"] == "2025-06-18"
    assert [r["error"]["code"] for r in replies[3:]] == [-32601, -32602, -32700]
    tools = {t["name"]: t for t in replies[1]["result"]["tools"]}
    assert {"overview", "messages_attention", "tasks_create", "sync", "messages_send_preview",
            "messages_send_confirm", "messages_edit_confirm", "messages_retract_confirm"} <= tools.keys()
    assert not tools.keys() & {"messages_send", "groups_remove", "groups_kind", "groups_rules", "config_update",
                               "projects_create", "sources_pause", "auth_login", "uploads_create", "ai_ask"}
    confirm = tools["messages_send_confirm"]
    assert set(confirm["inputSchema"]["required"]) == {"operation_id", "group", "text", "group_name"}
    assert confirm["annotations"]["destructiveHint"] and tools["overview"]["annotations"]["readOnlyHint"]


def test_platform_changes_need_a_matching_confirm(server, store):
    group = store.conversations()[0]["id"]
    _, body = call(server, "messages_send_preview", group=group, text="收到")
    plan = body["preview"]
    assert (plan["group"], plan["kind"]) == ("测试群", "test")
    ok = {"operation_id": plan["operation_id"], "group": group, "text": "收到", "group_name": "测试群"}
    for wrong, error in [({"group_name": "别的群"}, "group_name 与预览不一致"), ({"text": "改了"}, "与预览不一致"),
                         ({"group_name": None}, "缺少参数：group_name")]:
        args = {k: v for k, v in {**ok, **wrong}.items() if v is not None}
        failed, text = call(server, "messages_send_confirm", **args)
        assert failed and error in text
    assert server.calls == []
    assert call(server, "messages_send_confirm", **ok)[1]["sent"]

    store.set_kind(group, "prod")
    mine = store.db.execute("SELECT id FROM messages WHERE remote_id = 'me'").fetchone()[0]
    _, body = call(server, "messages_retract_preview", id=mine)
    assert (body["preview"]["text"], body["preview"]["kind"]) == ("你好", "prod")
    failed, text = call(server, "messages_retract_confirm", id=mine, group_name="测试群")
    assert failed and "正式群" in text
    assert not call(server, "messages_retract_confirm", id=mine, group_name="测试群", prod=True)[0]
    assert server.calls == [("send", "收到"), ("retract",)]
    via = {r[0]: r[1] for r in store.db.execute("SELECT action, via FROM audit WHERE action LIKE 'message.%'")}
    assert via == {"message.send": "mcp", "message.retract": "mcp"}
