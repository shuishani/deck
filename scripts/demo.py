"""生成演示用的 deck 数据目录：假数据、假命令行工具，不连接任何真实平台。

    uv run python scripts/demo.py /tmp/deck-demo --port 18780

刻意覆盖界面上容易出问题的情况：多个项目、二十多个群、超长群名、监听异常、
各种提醒规则、未读与 @我、超时未回、各状态的任务、已清理的关联消息、失败的操作日志。
"""
import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from deck import actions
from deck import config as config_module
from deck.adapters.base import Conversation, Message
from deck.store import PERSONAL, Store

ME = "李明"
NOW = datetime.now(timezone.utc)

FAKE_DWS = """#!/bin/sh
case "$*" in
  "--version") echo "dws version v1.0.67 (demo)";;
  "auth status -f json") echo '{"user_id": "u-demo", "user_name": "%s"}';;
  *) echo "演示环境不连接真实平台" >&2; exit 1;;
esac
""" % ME

FAKE_DRLEE = """#!/bin/sh
case "$*" in
  "--version") echo "drlee 0.0.8";;
  "--json auth list") echo '{"data": [{"current": true, "email": "liming@example.com", "credential_state": "valid", "access_expires_at": %d}]}';;
  *) echo "演示环境不连接真实平台" >&2; exit 1;;
esac
""" % int((NOW + timedelta(hours=8)).timestamp())

PROJECTS = [
    ("mx", "Management-X", "/Users/demo/code/management-x"),
    ("ops", "运维平台", None),
    ("delivery", "客户交付-华东区域二期项目", None),
]

# (项目, 平台, 群名, 类型, 规则, 监听错误)
GROUPS = [
    ("mx", "dingtalk", "management-x-dev-TEST", "test", None, None),
    ("mx", "dingtalk", "MX 产品需求讨论", "prod", None, None),
    ("mx", "channel", "MX 前端研发", "prod", None, None),
    ("mx", "channel", "MX 后端研发", "prod", {"scope": "mentions"}, None),
    ("mx", "dingtalk", "MX 测试与验收", "test", None, None),
    ("mx", "channel", "MX 发布通知", "prod", None, "timed out"),
    ("mx", "dingtalk", "MX 设计评审", "prod", {"scope": "keywords", "keywords": ["评审", "改稿"]}, None),
    ("mx", "channel", "MX 每日站会", "prod", None, None),
    ("ops", "dingtalk", "运维值班群", "prod", {"scope": "mentions", "quiet_start": "22:00", "quiet_end": "08:00"}, None),
    ("ops", "channel", "告警通知-生产环境-华东一区-数据库与中间件-非常长的群名称用来测试截断", "prod",
     {"scope": "keywords", "keywords": ["P0", "宕机", "不可用"]}, None),
    ("ops", "dingtalk", "数据库维护", "prod", None, None),
    ("ops", "channel", "网络与安全", "prod", None, "reauthentication_required"),
    ("ops", "dingtalk", "运维周报", "prod", {"quiet_start": "00:00", "quiet_end": "00:00"}, None),
    ("delivery", "dingtalk", "客户A 项目群", "prod", None, None),
    ("delivery", "dingtalk", "客户B 项目群（交付+售后）", "prod", None, None),
    ("delivery", "channel", "客户C 联调测试", "test", None, None),
    ("delivery", "dingtalk", "客户D 验收", "prod", None, None),
    ("delivery", "channel", "交付周会", "prod", None, None),
    ("delivery", "dingtalk", "售前支持", "prod", {"scope": "mentions"}, None),
    ("delivery", "channel", "实施团队", "prod", None, None),
    ("delivery", "dingtalk", "客户E 培训群", "prod", None, None),
    ("delivery", "channel", "客户F 二期需求", "prod", None, None),
    ("delivery", "dingtalk", "合同与商务", "prod", None, None),
    ("delivery", "channel", "交付文档", "test", None, None),
]

PEOPLE = ["张伟", "王芳", "刘洋", "陈静", "杨磊", "赵敏", "黄强", "周婷", "management-x-dev"]

LINES = [
    "今天下午三点开评审会，大家记得提前看一下文档",
    f"@{ME} 帮忙看下这个接口，返回 500 了",
    "上传附件一直失败，怎么回事？",
    "收到",
    "这个需求下周一前能排进来吗",
    "我这边已经提测了，测试环境地址还是原来那个",
    f"@{ME} 合同的第三条需要你确认一下，客户那边在等",
    "登录页白屏，刷新也不行，有人遇到过吗",
    "好的，我晚点处理",
    "【构建通知】master 分支构建成功，耗时 3 分 12 秒",
    "这里是一段比较长的消息，用来测试多行展示的效果：客户反馈在导出报表的时候，如果选择的时间范围超过三个月，"
    "页面会一直转圈，最后提示超时；同时后台日志里有大量慢查询，怀疑是索引没有命中，需要后端和 DBA 一起看一下。",
    "P0：订单服务不可用，已经回滚，正在排查",
    "辛苦了 👍",
    f"@{ME} 周报今天能发吗",
    "数据库凌晨两点做主从切换，期间可能有一分钟不可用",
]


def message(source, conversation, index, sender, text, at, mine=False, reply_to=None):
    sender_id = "me" if mine else f"u-{PEOPLE.index(sender) if sender in PEOPLE else 0}"
    raw = {"text": text}
    return Message(source, f"{conversation}-{index}", conversation, sender_id, ME if mine else sender,
                   text, at, reply_to, raw)


def build(home: Path, port: int) -> None:
    if home.exists():
        shutil.rmtree(home)
    tools = home / "bin"
    tools.mkdir(parents=True)
    for name, script in (("dws", FAKE_DWS), ("drlee", FAKE_DRLEE)):
        path = tools / name
        path.write_text(script)
        path.chmod(0o755)
    config_path = config_module.init(home, str(tools / "dws"), str(tools / "drlee"))
    text = config_path.read_text()
    text = re.sub(r"(?m)^port = .*", f"port = {port}", text)
    text = re.sub(r"(?m)^host = .*", 'host = "127.0.0.1"', text)
    config_path.write_text(text)

    store = Store(config_module.load(home).db_path)
    for key, name, repo in PROJECTS:
        store.add_project(key, name, repo)
    for source in ("dingtalk", "channel"):
        store.add_self_ids(source, {"me"})

    first_ids = []
    for g, (project, source, name, kind, rule, error) in enumerate(GROUPS):
        id = store.add_conversation(project, Conversation(source, f"demo-{g}", name))
        store.set_kind(id, kind)
        if rule:
            store.set_rules(id, {"scope": "all", "keywords": [], "quiet_start": None, "quiet_end": None, **rule})
        count = 0 if g in (17, 23) else 3 + (g * 5) % 10
        messages = []
        for i in range(count):
            at = NOW - timedelta(minutes=(count - i) * (37 + g * 11))
            mine = i % 4 == 3
            sender = PEOPLE[(g + i) % len(PEOPLE)]
            text = LINES[(g * 3 + i) % len(LINES)]
            reply_to = f"demo-{g}-{i - 1}" if not mine and i > 0 and i % 5 == 4 else None
            messages.append(message(source, f"demo-{g}", i, sender, text, at, mine, reply_to))
        store.add_messages(id, messages, {"me"})
        # 一半的群留些未读。
        if g % 2 == 0 and messages:
            store.db.execute("UPDATE conversations SET read_at = ? WHERE id = ?",
                             ((NOW - timedelta(hours=3)).isoformat(timespec="seconds"), id))
        store.db.execute("UPDATE conversations SET last_sync_at = ?, last_error = ? WHERE id = ?",
                         ((NOW - timedelta(minutes=g)).isoformat(timespec="seconds"), error, id))
        store.db.commit()
        row = store.db.execute("SELECT MIN(id) FROM messages WHERE conversation = ?", (id,)).fetchone()[0]
        first_ids.append(row)

    # 单聊：一条等我回复，一条我已回，一个只监听。
    for i, (source, name, mode) in enumerate((("dingtalk", "王芳", "ai"), ("dingtalk", "刘洋", "listen"),
                                               ("channel", "陈静", "listen"))):
        remote = f"demo-dm-{i}"
        id = store.add_conversation(PERSONAL, Conversation(source, remote, name), chat="direct", mode=mode)
        store.add_messages(id, [
            message(source, remote, 0, name, "在吗？登录页又白屏了，能帮忙看下吗", NOW - timedelta(minutes=25 + i * 90)),
            *([message(source, remote, 1, name, "好的，我看下", NOW - timedelta(minutes=10), mine=True)] if i == 1 else []),
        ], {"me"})

    tasks = [
        ("修复上传附件失败", "mx", "doing", "urgent", (NOW + timedelta(days=1)).date(), [first_ids[0], first_ids[2]]),
        ("登录页白屏排查", "mx", "todo", "high", (NOW - timedelta(days=2)).date(), [first_ids[4]]),
        ("整理 MX 二期需求清单，和产品、设计一起过一遍优先级，周五前给出排期", "mx", "review", "medium", None, []),
        ("数据库主从切换演练", "ops", "done", "medium", (NOW - timedelta(days=1)).date(), [first_ids[10]]),
        ("订单服务 P0 复盘", "ops", "todo", "high", NOW.date(), [first_ids[9]]),
        ("客户A 验收材料", "delivery", "doing", "medium", (NOW + timedelta(days=7)).date(), [first_ids[13]]),
        ("合同第三条确认", "delivery", "todo", "low", None, [first_ids[22]]),
        ("个人：更新简历", None, "todo", "low", None, []),
    ]
    for title, project, status, priority, due, linked in tasks:
        task = actions.add_task(store, {"title": title, "project": project, "status": status, "priority": priority,
                                        "due": due.isoformat() if due else None,
                                        "message_ids": [m for m in linked if m]})
    # 挂着的消息已过保留期被清理。
    store.link_task_message(task["id"] - 3, 99999, "me")

    for action, target, detail, result, _ in [
        ("message.send", "dingtalk:demo-0", {"group": "management-x-dev-TEST", "text": "收到"}, "ok", 50),
        ("message.send", "channel:demo-5", {"group": "MX 发布通知", "text": "已发布"},
         "error: drlee: Validation failed: invalid thread_root_id", 40),
        ("task.add", "1", {"title": "修复上传附件失败"}, "ok", 30),
        ("group.rules", "9", {"group": "运维值班群"}, "ok", 20),
        ("config.update", "settings", {"reply_reminder_hours": 2}, "ok", 10),
    ]:
        store.audit("me", action, target, detail, result)
    # 操作日志按编号排序：时间也按编号递增，越新越近。
    ids = [r[0] for r in store.db.execute("SELECT id FROM audit ORDER BY id")]
    for i, id in enumerate(ids):
        at = NOW - timedelta(minutes=5 * (len(ids) - i))
        store.db.execute("UPDATE audit SET at = ? WHERE id = ?", (at.isoformat(timespec="seconds"), id))
    store.db.commit()
    store.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("home", type=Path, help="演示数据目录（会被清空重建）")
    parser.add_argument("--port", type=int, default=18780)
    args = parser.parse_args()
    home = args.home.resolve()
    if home == (Path.home() / ".deck").resolve():
        print("不能覆盖正式数据目录", file=sys.stderr)
        return 1
    build(home, args.port)
    print(json.dumps({"home": str(home), "port": args.port}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
