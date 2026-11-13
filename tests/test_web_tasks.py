"""网页接口：任务、日志、设置与项目。"""
import pytest

from deck.store import Store


def test_project_edit_and_group_move_preserve_history_and_tasks(api, store):
    w = {"X-Deck": "1"}
    _, task_body = api("POST", "/api/tasks", {"title": "保留任务", "project": "mx",
        "source": {"group_id": 1, "group_name": "测试群", "message_id": 2,
                   "sender_name": "张三", "text": "看下"}}, w)
    task = task_body["task"]
    assert api("POST", "/api/projects/mx", {"name": "新名称", "repo": "/tmp/repo"}, w)[0] == 200
    project = api("GET", "/api/projects")[1]["projects"][0]
    assert project == {"key": "mx", "name": "新名称", "repo": "/tmp/repo"}
    assert api("POST", "/api/projects/mx", {"repo": None}, w)[0] == 200
    assert api("POST", "/api/projects/mx", {"key": "other"}, w)[0] == 400
    assert api("POST", "/api/projects/mx", {"name": " "}, w)[0] == 400
    assert api("POST", "/api/groups/1/project", {"project": "missing"}, w)[0] == 400
    api("POST", "/api/projects", {"key": "new", "name": "新项目"}, w)
    assert api("POST", "/api/groups/1/project", {"project": "new"}, w)[0] == 200
    assert len(api("GET", "/api/timeline?project=new")[1]["messages"]) == 2
    assert api("GET", "/api/tasks")[1]["tasks"] == [task]
    assert store.conversation(1)["project"] == "new"


def test_ai_http_defaults_and_placeholder_settings_do_not_call_models(api, monkeypatch):
    from deck import ai
    monkeypatch.setattr(ai, '_complete', lambda *_: (_ for _ in ()).throw(AssertionError('不能调用模型')))
    status, body = api('GET', '/api/ai/settings')
    assert status == 200 and not body['settings']['enabled'] and not body['settings']['configured']
    assert api('POST', '/api/ai/ask', {'question': '总结', 'group': 1}, {'X-Deck': '1'})[0] == 400
    status, body = api('POST', '/api/ai/settings', {'model': 'my-compatible-model'}, {'X-Deck': '1'})
    assert status == 200 and body['settings']['model'] == 'my-compatible-model'
    assert 'api_key' not in body['settings']


def test_settings_are_shared_with_cli_and_do_not_prune(api, config, store):
    from deck import config as config_module

    config_module.init(config.home, None, None)
    status, body = api("POST", "/api/config", {
        "reply_reminder_hours": 0.5, "retention_days": 7,
        "ignore_senders": ["通知"], "poll_seconds": 10, "ai_prefix": "助手：",
    }, {"X-Deck": "1"})
    assert status == 200
    assert body["config"]["reply_reminder_hours"] == 0.5
    loaded = config_module.load(config.home)
    assert (loaded.retention_days, loaded.ignore_senders, loaded.ai_prefix) == (7, ("通知",), "助手：")
    assert len(store.timeline()) == 2
    shown = api("GET", "/api/config")[1]
    assert shown["poll_seconds"] == 10 and "poll_seconds" in shown["overridden"]

    # 恢复默认：回到 config.toml 的值，不需要重启；其他覆盖值不受影响。
    assert api("POST", "/api/config", {"reset": ["poll_seconds"]}, {"X-Deck": "1"})[0] == 200
    shown = api("GET", "/api/config")[1]
    assert shown["poll_seconds"] == shown["defaults"]["poll_seconds"] and "poll_seconds" not in shown["overridden"]
    assert shown["retention_days"] == 7
    assert api("POST", "/api/config", {"reset": ["server"]}, {"X-Deck": "1"})[0] == 400


@pytest.mark.parametrize("body", [
    {"retention_days": 0}, {"poll_seconds": True}, {"reply_reminder_hours": -1},
    {"reply_reminder_hours": float("inf")}, {"ignore_senders": "robot"},
    {"server": {"host": "0.0.0.0"}}, {"ai_prefix": 123},
])
def test_settings_reject_invalid_or_security_fields(api, body):
    assert api("POST", "/api/config", body, {"X-Deck": "1"})[0] == 400


def test_tasks_crud_and_version_changes(api, store):
    w = {"X-Deck": "1"}
    _, before = api("GET", "/api/version")
    status, body = api("POST", "/api/tasks", {
        "title": " 修网盘上传 ", "project": "mx", "priority": "high", "due": "2026-11-20",
        "source": {"group_id": 1, "group_name": "测试群", "message_id": 2,
                   "sender_name": "张三", "text": "@李涛 看下"}}, w)
    assert status == 200
    task = body["task"]
    assert (task["title"], task["status"], task["created_by"]) == ("修网盘上传", "todo", "me")
    assert task["source"]["sender_name"] == "张三"
    assert store.db.execute("SELECT via FROM audit WHERE action = 'task.add'").fetchone()[0] == "web"
    after = api("GET", "/api/version")[1]
    assert after["version"] != before["version"]
    changed = {k for k in after["parts"] if after["parts"][k] != before["parts"][k]}
    assert changed == {"tasks"}

    # 只有同步时间变了：各类版本都不变，网页不重拉。
    with store.db:
        store.db.execute("UPDATE conversations SET last_sync_at = '2030-01-01T00:00:00+00:00'")
    assert api("GET", "/api/version")[1]["parts"] == after["parts"]

    _, body = api("POST", f"/api/tasks/{task['id']}", {"status": "doing", "due": None}, w)
    assert (body["task"]["status"], body["task"]["due"]) == ("doing", None)
    assert [t["id"] for t in api("GET", "/api/tasks?project=mx")[1]["tasks"]] == [task["id"]]
    assert api("GET", "/api/tasks?status=done")[1]["tasks"] == []

    for bad in ({"title": " "}, {"status": "later"}, {"due": "下周"}, {"project": "nope"},
                {"source": {"group_id": 1}}):
        assert api("POST", "/api/tasks", {"title": "x", **bad}, w)[0] == 400
    assert api("POST", "/api/tasks/999", {"status": "done"}, w)[0] == 400

    assert api("DELETE", f"/api/tasks/{task['id']}", headers=w)[0] == 200
    assert api("GET", "/api/tasks")[1]["tasks"] == []
    actions = [e["action"] for e in api("GET", "/api/log")[1]["entries"]]
    assert actions[:3] == ["task.remove", "task.update", "task.add"]


def test_log_filters_and_describes_entries(api, store):
    store.audit("me", "access.pairing", "127.0.0.1", {}, "ok")
    store.audit("ai", "message.send", "dingtalk:cid", {"group": "旧群", "text": "以前的 AI 身份发送"}, "ok")
    store.audit("me", "message.send", "dingtalk:cid", {"group": "测试群", "text": "报错了"},
                "error: /Users/x/deck/tools/drlee/drlee --json channel 失败：Validation failed")
    store.audit("me", "group.rules", "1", {"scope": "mention"}, "ok")
    store.audit("me", "access.password", "local", {}, "set")

    entries = api("GET", "/api/log")[1]["entries"]
    assert entries[0]["outcome"] == "已设置" and entries[0]["status"] == "ok"
    assert entries[1]["object"] == {"kind": "group", "id": 1, "label": "测试群"} and entries[1]["label"] == "修改群提醒规则"
    assert "access.pairing" not in [e["action"] for e in api("GET", "/api/log?noise=0")[1]["entries"]]

    failed = api("GET", "/api/log?failed=1")[1]["entries"]
    assert [e["outcome"] for e in failed] == ["失败：drlee：Validation failed"]
    old = api("GET", "/api/log?category=message&q=%E4%BB%A5%E5%89%8D")[1]["entries"]
    assert [(e["actor"], e["as_ai"]) for e in old] == [("me", True)]
    assert api("GET", "/api/log?category=nope")[0] == 400

    page = api("GET", "/api/log?limit=2")[1]
    rest = api("GET", f"/api/log?limit=2&before={page['entries'][-1]['id']}")[1]
    assert page["has_more"] and rest["entries"][0]["id"] < page["entries"][-1]["id"]


def test_messages_show_their_tasks_and_can_be_fetched_for_a_reply(api):
    w = {"X-Deck": "1"}
    question = next(m for m in api("GET", "/api/timeline?group=1")[1]["messages"] if not m["is_me"])
    assert question["tasks"] == []
    source = {"group_id": 1, "group_name": "测试群", "message_id": question["id"],
              "sender_name": question["sender_name"], "text": question["text"]}
    task = api("POST", "/api/tasks", {"title": "看下问题", "source": source}, w)[1]["task"]
    api("POST", f"/api/tasks/{task['id']}", {"status": "doing"}, w)

    linked = next(m for m in api("GET", "/api/timeline?group=1")[1]["messages"] if m["id"] == question["id"])
    assert linked["tasks"] == [{"id": task["id"], "title": "看下问题", "status": "doing"}]
    around = api("GET", f"/api/timeline?group=1&around={question['id']}")[1]["messages"]
    assert next(m for m in around if m["id"] == question["id"])["tasks"][0]["id"] == task["id"]

    status, body = api("GET", f"/api/messages/{question['id']}")
    assert status == 200 and body["message"]["remote_id"] == question["remote_id"]
    assert api("GET", "/api/messages/9999")[0] == 404


def test_task_collects_messages_and_keeps_its_source(api, store, config):
    w = {"X-Deck": "1"}
    messages = api("GET", "/api/timeline?group=1")[1]["messages"]
    question = next(m for m in messages if not m["is_me"])
    other = next(m for m in messages if m["id"] != question["id"])
    source = {"group_id": 1, "group_name": "测试群", "message_id": question["id"],
              "sender_name": question["sender_name"], "text": question["text"]}
    task = api("POST", "/api/tasks", {"title": "同一个问题", "source": source}, w)[1]["task"]
    assert task["message_count"] == 1

    assert api("POST", f"/api/tasks/{task['id']}/messages", {"message_id": other["id"]}, w)[1]["task"]["message_count"] == 2
    assert api("POST", f"/api/tasks/{task['id']}/messages", {"message_id": other["id"]}, w)[1]["task"]["message_count"] == 2
    assert api("POST", f"/api/tasks/{task['id']}/messages", {"message_id": 9999}, w)[0] == 400
    detail = api("GET", f"/api/tasks/{task['id']}")[1]
    by_time = sorted([question, other], key=lambda m: m["sent_at"])
    assert [m["id"] for m in detail["messages"]] == [m["id"] for m in by_time] and detail["missing"] == []
    assert all(m["tasks"][0]["id"] == task["id"] for m in api("GET", "/api/timeline?group=1")[1]["messages"]
               if m["id"] in (question["id"], other["id"]))

    assert api("DELETE", f"/api/tasks/{task['id']}/messages/{question['id']}", None, w)[0] == 400
    assert api("DELETE", f"/api/tasks/{task['id']}/messages/{other['id']}", None, w)[1]["task"]["message_count"] == 1

    # 升级前建的任务：来源消息补进关联表。
    with store.db:
        store.db.execute("DELETE FROM task_messages")
        store.db.execute("DELETE FROM settings WHERE key = 'migrated:task_messages'")
        store.db.execute("PRAGMA user_version = 0")
    Store(config.db_path).close()
    assert api("GET", f"/api/tasks/{task['id']}")[1]["task"]["message_count"] == 1

    api("DELETE", f"/api/tasks/{task['id']}", None, w)
    assert store.db.execute("SELECT COUNT(*) FROM task_messages").fetchone()[0] == 0

    # 多选：建任务时一起挂上其余消息，加入已有任务也可一次多条。
    both = [question["id"], other["id"]]
    status, body = api("POST", "/api/tasks", {"title": "多条", "source": source, "message_ids": both}, w)
    assert status == 200 and body["task"]["message_count"] == 2
    assert api("POST", "/api/tasks", {"title": "坏", "message_ids": [9999]}, w)[0] == 400
    plain = api("POST", "/api/tasks", {"title": "后加"}, w)[1]["task"]
    assert api("POST", f"/api/tasks/{plain['id']}/messages", {"message_ids": both}, w)[1]["task"]["message_count"] == 2
