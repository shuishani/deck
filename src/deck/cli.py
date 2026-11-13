import argparse
import fcntl
import json
import os
import shutil
import signal
import sqlite3
import stat
import sys
from datetime import datetime

from . import access, actions, ai, logview, search, sending
from . import config as config_module
from .adapters import SOURCES, adapter_for
from .attention import attention
from .content import summary
from .runner import ToolError
from .store import Store
from .sync import sync


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        return args.run(args) or 0
    except (FileNotFoundError, ToolError, ValueError, LookupError) as error:
        _emit(args, {"ok": False, "error": str(error)}, f"错误：{error}")
        return 1
    except sqlite3.IntegrityError:
        _emit(args, {"ok": False, "error": "记录已存在"}, "错误：记录已存在，不能重复添加")
        return 1


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="deck", description="个人项目与消息中枢")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出，供脚本和 agent 使用")
    sub = parser.add_subparsers(required=True, metavar="命令")

    p = sub.add_parser("init", help="初始化 ~/.deck 目录和配置文件")
    p.add_argument("--dws", help="dws 可执行文件路径")
    p.add_argument("--drlee", help="drlee 可执行文件路径")
    p.set_defaults(run=_init)

    project = sub.add_parser("project", help="项目").add_subparsers(required=True, metavar="操作")
    p = project.add_parser("add", help="登记项目")
    p.add_argument("key", help="项目简称，例如 mx")
    p.add_argument("--name", required=True)
    p.add_argument("--repo", help="代码仓库路径")
    p.set_defaults(run=_project_add)
    project.add_parser("list", help="列出项目").set_defaults(run=_project_list)
    p = project.add_parser("set", help="修改项目名称或仓库（简称不变）")
    p.add_argument("key")
    p.add_argument("--name")
    p.add_argument("--repo")
    p.set_defaults(run=_project_set)

    settings = sub.add_parser("config", help="消息与提醒设置，与看板共用").add_subparsers(required=True)
    settings.add_parser("show", help="查看有效设置").set_defaults(run=_config_show)
    p = settings.add_parser("set", help="用 JSON 对象修改设置，不触发自动清理")
    p.add_argument("values")
    p.set_defaults(run=_config_set)
    p = settings.add_parser("reset", help="去掉网页或 CLI 改过的值，回到 config.toml 的默认值")
    p.add_argument("keys", nargs="+", choices=config_module.EDITABLE)
    p.set_defaults(run=_config_reset)

    group = sub.add_parser("group", help="监测的群").add_subparsers(required=True, metavar="操作")
    p = group.add_parser("add", help="将群加入项目监测")
    p.add_argument("project")
    p.add_argument("source", choices=SOURCES)
    p.add_argument("query", help="群名或原始 id")
    p.set_defaults(run=_group_add)
    p = group.add_parser("list", help="列出监测的群")
    p.add_argument("--project")
    p.set_defaults(run=_group_list)
    p = group.add_parser("remove", help="停止监测（同时删除本地消息）")
    p.add_argument("id", type=int)
    p.set_defaults(run=_group_remove)
    p = group.add_parser("kind", help="设置群类型（正式群发送前需二次确认）")
    p.add_argument("id", type=int)
    p.add_argument("kind", choices=actions.KINDS)
    p.set_defaults(run=_group_kind)
    p = group.add_parser("rules", help="用 JSON 对象设置提醒规则，不影响完整消息同步")
    p.add_argument("id", type=int)
    p.add_argument("values")
    p.set_defaults(run=_group_rules)
    p = group.add_parser("move", help="调整群所属项目，保留消息和已有任务")
    p.add_argument("id", type=int)
    p.add_argument("project")
    p.set_defaults(run=_group_move)

    task = sub.add_parser("task", help="任务").add_subparsers(required=True, metavar="操作")
    p = task.add_parser("list", help="列出任务（默认不含已完成）")
    p.add_argument("--project")
    p.add_argument("--status", choices=actions.TASK_STATUSES)
    p.add_argument("--all", action="store_true", help="包含已完成任务")
    p.set_defaults(run=_task_list)
    for name, help_text in (("add", "新建任务"), ("set", "修改任务")):
        p = task.add_parser(name, help=help_text)
        if name == "add":
            p.add_argument("title")
        else:
            p.add_argument("id", type=int)
            p.add_argument("--title")
            p.add_argument("--status", choices=actions.TASK_STATUSES)
        p.add_argument("--project", help="项目简称（set 时传空字符串表示移出项目）")
        p.add_argument("--priority", choices=actions.TASK_PRIORITIES)
        p.add_argument("--due", help="截止日期，格式 YYYY-MM-DD（set 时传空字符串表示清除）")
        p.add_argument("--desc", help="任务描述")
        p.set_defaults(run=_task_add if name == "add" else _task_set)
    p = task.add_parser("done", help="标为已完成")
    p.add_argument("id", type=int)
    p.set_defaults(run=_task_done)
    p = task.add_parser("remove", help="删除任务")
    p.add_argument("id", type=int)
    p.set_defaults(run=_task_remove)
    p = task.add_parser("show", help="查看任务和它关联的全部消息")
    p.add_argument("id", type=int)
    p.set_defaults(run=_task_show)
    for name, help_text in (("link", "把消息加入任务（可来自不同群）"), ("unlink", "把消息移出任务（来源消息不能移出）")):
        p = task.add_parser(name, help=help_text)
        p.add_argument("id", type=int)
        p.add_argument("message", type=int, help="消息编号（timeline、search 结果中的 #编号）")
        p.set_defaults(run=_task_link, unlink=name == "unlink")

    p = sub.add_parser("sync", help="同步监测群的新消息")
    p.add_argument("--project")
    p.set_defaults(run=_sync)

    p = sub.add_parser("timeline", help="按时间查看消息")
    p.add_argument("--project")
    p.add_argument("--group", type=int)
    p.add_argument("--mine", action="store_true", help="仅显示我发送的消息")
    p.add_argument("--limit", type=int, default=30)
    p.set_defaults(run=_timeline)

    p = sub.add_parser("search", help="检索本地全部已同步消息文本")
    p.add_argument("query")
    p.add_argument("--project")
    p.add_argument("--group", type=int)
    p.add_argument("--cursor")
    p.add_argument("--limit", type=int, default=30)
    p.set_defaults(run=_search)

    ai_commands = sub.add_parser("ai", help="模型设置、问答和待审核草稿，不自动发送").add_subparsers(required=True)
    ai_commands.add_parser("settings", help="查看 AI 配置和用量，不显示密钥").set_defaults(run=_ai_settings)
    p = ai_commands.add_parser("configure", help="用 JSON 修改模型配置，密钥只引用环境变量名")
    p.add_argument("values")
    p.add_argument("--approve-endpoint", action="store_true", help="在本机批准当前接口地址；本机以外的地址都须批准后才能调用")
    p.set_defaults(run=_ai_configure)
    p = ai_commands.add_parser("ask", help="向已配置模型提问，指定范围才附带本地上下文")
    p.add_argument("question")
    p.add_argument("--project")
    p.add_argument("--group", type=int)
    p.set_defaults(run=_ai_ask)
    p = ai_commands.add_parser("draft", help="针对消息生成草稿，不发送或标记处理")
    p.add_argument("id", type=int)
    p.add_argument("--instruction", default="")
    p.set_defaults(run=_ai_draft)

    p = sub.add_parser("awaiting", help="待处理的消息：需回复（@我、回复我）和疑似问题")
    p.add_argument("--project")
    p.set_defaults(run=_awaiting)

    p = sub.add_parser("edit", help="修改自己发的消息（不加 --yes 时仅预览）")
    p.add_argument("id", type=int, help="消息编号")
    p.add_argument("--text", required=True)
    p.add_argument("--yes", action="store_true", help="确认修改")
    p.set_defaults(run=_edit)
    p = sub.add_parser("retract", help="撤回自己发的消息（群内所有人都将看不到）")
    p.add_argument("id", type=int, help="消息编号")
    p.add_argument("--yes", action="store_true", help="确认撤回")
    p.set_defaults(run=_retract)

    p = sub.add_parser("handle", help="将消息标记为已处理（--undo 撤销）")
    p.add_argument("id", type=int, help="消息编号（deck timeline / awaiting --json 中的 id）")
    p.add_argument("--undo", action="store_true", help="撤销已处理标记")
    p.set_defaults(run=_handle)

    p = sub.add_parser("send", help="向监测的群发送消息（不加 --yes 时仅预览）")
    p.add_argument("group", type=int)
    p.add_argument("--text")
    p.add_argument("--operation", help="确认此前预览的操作编号，重试同一编号不会重复发送")
    p.add_argument("--reply-to", help="回复的消息原始 id")
    p.add_argument("--ai", action="store_true", help="以 AI 身份发送，自动添加 ai_prefix 前缀")
    p.add_argument("--yes", action="store_true", help="确认发送")
    p.set_defaults(run=_send)

    p = sub.add_parser("log", help="操作日志（新到旧）")
    p.add_argument("--limit", type=int, default=30)
    p.add_argument("--category", choices=list(logview.CATEGORIES),
                   help="分类：" + "、".join(f"{k} {v[0]}" for k, v in logview.CATEGORIES.items()))
    p.add_argument("--failed", action="store_true", help="只看失败")
    p.add_argument("--actor", choices=("me", "ai"))
    p.add_argument("--search", default="", help="在内容、对象、结果中查找")
    p.add_argument("--since", help="起始日期，如 2026-11-01")
    p.add_argument("--before", type=int, help="只看编号小于它的记录（翻页）")
    p.add_argument("--quiet", action="store_true", help="不显示登录码、监听开关这类记录")
    p.set_defaults(run=_log)

    p = sub.add_parser("prune", help="删除超过保留期限的消息")
    p.set_defaults(run=_prune)

    p = sub.add_parser("watch", help="常驻监听（不启动看板）")
    p.set_defaults(run=_watch)

    p = sub.add_parser("serve", help="启动看板（默认同时常驻监听）")
    p.add_argument("--host", help="监听地址；局域网访问请用 0.0.0.0（默认读取配置，通常为 127.0.0.1）")
    p.add_argument("--port", type=int, help="端口（默认读取配置，通常为 8765）")
    p.add_argument("--no-watch", action="store_true", help="仅启动看板，不监听")
    p.set_defaults(run=_serve)

    access_cmd = sub.add_parser("access", help="看板访问设备管理").add_subparsers(
        required=True, metavar="操作")
    p = access_cmd.add_parser("setup", help="预览固定入口和单主机路由方案；不会发布路由")
    p.add_argument("url", help="统一使用的本机局域网 URL")
    p.add_argument("--yes", action="store_true", help="只保存固定入口；网络路由仍须单独确认执行")
    p.set_defaults(run=_access_setup)
    p = access_cmd.add_parser("link", help="生成一次性登录链接（10 分钟内有效）")
    p.add_argument("--url", help="仅为指定地址生成，例如中继地址")
    p.set_defaults(run=_access_link)
    access_cmd.add_parser("list", help="已登录的设备").set_defaults(run=_access_list)
    p = access_cmd.add_parser("revoke", help="移除设备（需重新配对才能使用）")
    p.add_argument("id", nargs="?", type=int)
    p.add_argument("--all", action="store_true", help="所有设备")
    p.set_defaults(run=_access_revoke)
    for name, disable in (("disable", True), ("enable", False)):
        p = access_cmd.add_parser(name, help="禁用设备（保留登录，可重新启用）" if disable else "重新启用设备")
        p.add_argument("id", type=int)
        p.set_defaults(run=_access_toggle, disable=disable)
    p = access_cmd.add_parser("password", help="设置本机密码（仅在本机用 127.0.0.1 打开时可用）")
    p.add_argument("--clear", action="store_true", help="清除本机密码")
    p.set_defaults(run=_access_password)

    p = sub.add_parser("call", help="按名称调用操作（与看板接口同一套），输出 JSON；不带名称时列出全部操作")
    p.add_argument("name", nargs="?", help="操作名，如 tasks.create")
    p.add_argument("params", nargs="?", default="{}", help="JSON 对象形式的参数")
    p.set_defaults(run=_call)
    return parser


# --- 命令 ---


def _init(args) -> None:
    base = config_module.home()
    path = config_module.init(base, args.dws, args.drlee)
    Store(config_module.load(base).db_path).close()
    _emit(args, {"ok": True, "home": str(base), "config": str(path)}, f"初始化完成：{path}")


def _project_add(args) -> None:
    with _store() as (store, _):
        actions.add_project(store, args.key, args.name, args.repo)
    _emit(args, {"ok": True, "project": args.key}, f"已登记项目：{args.key}")


def _project_set(args) -> None:
    data = {k: getattr(args, k) for k in ("name", "repo") if getattr(args, k) is not None}
    with _store() as (store, _):
        row = actions.update_project(store, args.key, data)
    _emit(args, {"ok": True, "project": dict(row)}, "项目已更新")


def _json_values(text: str) -> dict:
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("设置须为 JSON 对象")
    return data


def _config_show(args) -> None:
    with _store() as (_, config):
        values = {key: getattr(config, key) for key in config_module.EDITABLE}
    _emit(args, values, json.dumps(values, ensure_ascii=False, indent=2))


def _config_reset(args) -> None:
    with _store() as (store, _):
        actions.configure(store, {"reset": list(args.keys)})
    _emit(args, {"ok": True, "reset": args.keys}, f"已恢复默认：{'、'.join(args.keys)}")


def _config_set(args) -> None:
    with _store() as (store, _):
        values = actions.configure(store, _json_values(args.values))
    _emit(args, {"ok": True, "config": values}, "设置已保存；不会自动删除消息")


def _group_rules(args) -> None:
    with _store() as (store, _):
        rule = actions.set_group_rules(store, args.id, _json_values(args.values))
    _emit(args, {"ok": True, "rules": rule}, "提醒规则已保存，消息仍完整同步")


def _group_move(args) -> None:
    with _store() as (store, _):
        row = actions.move_group(store, args.id, args.project)
    _emit(args, {"ok": True, "group": dict(row)}, "群已调整所属项目，已有任务归属不变")


def _project_list(args) -> None:
    with _store() as (store, _):
        rows = store.projects()
    _emit(args, _rows(rows), "\n".join(f"{r['key']}\t{r['name']}\t{r['repo'] or ''}" for r in rows)
          or "暂无项目")


def _group_add(args) -> None:
    with _store() as (store, config):
        row = actions.add_group(store, lambda s: adapter_for(s, config),
                                args.project, args.source, args.query)
    _emit(args, {"ok": True, "id": row["id"], "name": row["name"]},
          f"已开始监测：[{row['id']}] {row['source']} · {row['name']}")


def _group_list(args) -> None:
    with _store() as (store, _):
        rows = store.conversations(args.project)
    _emit(args, _rows(rows), "\n".join(
        f"[{r['id']}] {r['project']}\t{r['source']}\t{_KIND_LABEL.get(r['kind'], '')}\t{r['name']}"
        for r in rows) or "暂无监测的群")


def _group_remove(args) -> None:
    with _store() as (store, _):
        row = actions.remove_group(store, args.id)
    _emit(args, {"ok": True}, f"已停止监测：[{args.id}] {row['name']}")


def _group_kind(args) -> None:
    with _store() as (store, _):
        row = actions.set_group_kind(store, args.id, args.kind)
    _emit(args, {"ok": True, "id": row["id"], "kind": row["kind"]},
          f"已将 [{row['id']}] {row['name']} 设为{_KIND_LABEL[row['kind']]}")


_KIND_LABEL = {"test": "测试群", "prod": "正式群"}
_STATUS_LABEL = {"todo": "待处理", "doing": "进行中", "review": "待审阅", "done": "已完成"}
_PRIORITY_LABEL = {"low": "低", "medium": "中", "high": "高", "urgent": "紧急"}


def _task_options(args) -> dict:
    """只取命令行给出的字段；传空字符串表示清空。"""
    names = {"title": "title", "status": "status", "project": "project",
             "priority": "priority", "due": "due", "desc": "description"}
    return {field: getattr(args, arg) for arg, field in names.items()
            if getattr(args, arg, None) is not None}


def _task_line(task: dict) -> str:
    source = task.get("source")
    extra = task.get("message_count", 0) - (1 if source else 0)
    return "\t".join([f"[{task['id']}] {_STATUS_LABEL[task['status']]}",
                      _PRIORITY_LABEL[task['priority']], task["title"],
                      task["project"] or "-", f"截止 {task['due']}" if task["due"] else "-",
                      (f"来源 群{source['group_id']} 消息#{source['message_id']}" if source else "-")
                      + (f" 另 {extra} 条消息" if extra > 0 else "")])


def _task_show(args) -> None:
    with _store() as (store, _):
        row = store.task(args.id)
        if not row:
            raise ValueError(f"任务 {args.id} 不存在")
        task = actions.task_dict(row)
        ids = store.task_message_ids(args.id)
        messages = {i: store.message(i) for i in ids}
    lines = [_task_line(task)] + ([task["description"]] if task["description"] else [])
    lines += [_line(m) if m else f"#{i}（消息已过保留期限被清理）" for i, m in messages.items()]
    _emit(args, {"task": task, "messages": [
        {"id": i, **({"group": m["conversation_name"], "sender": m["sender_name"], "is_me": bool(m["is_me"]),
                      "sent_at": m["sent_at"], "text": summary(m["source"], m["raw"], m["text"])}
                     if m else {"missing": True})} for i, m in messages.items()]}, "\n".join(lines))


def _task_link(args) -> None:
    with _store() as (store, _):
        change = actions.unlink_task_message if args.unlink else actions.link_task_message
        task = change(store, args.id, args.message)
    _emit(args, {"ok": True, "task": task}, f"{'已移出' if args.unlink else '已加入'}：{_task_line(task)}")


def _task_list(args) -> None:
    with _store() as (store, _):
        rows = [actions.task_dict(r) for r in store.tasks(args.project, args.status)]
    if not args.all and not args.status:
        rows = [t for t in rows if t["status"] != "done"]
    _emit(args, rows, "\n".join(_task_line(t) for t in rows) or "暂无任务")


def _task_add(args) -> None:
    with _store() as (store, _):
        task = actions.add_task(store, _task_options(args))
    _emit(args, {"ok": True, "task": task}, f"已创建：{_task_line(task)}")


def _task_set(args) -> None:
    options = _task_options(args)
    if not options:
        raise ValueError("未指定要修改的字段")
    with _store() as (store, _):
        task = actions.update_task(store, args.id, options)
    _emit(args, {"ok": True, "task": task}, f"已更新：{_task_line(task)}")


def _task_done(args) -> None:
    with _store() as (store, _):
        task = actions.update_task(store, args.id, {"status": "done"})
    _emit(args, {"ok": True, "task": task}, f"已完成：{_task_line(task)}")


def _task_remove(args) -> None:
    with _store() as (store, _):
        task = actions.remove_task(store, args.id)
    _emit(args, {"ok": True}, f"已删除：[{args.id}] {task['title']}")


def _sync(args) -> int:
    with _store() as (store, config):
        results = sync(store, lambda source: adapter_for(source, config), args.project)
    data = [
        {"id": r.conversation["id"], "name": r.conversation["name"],
         "added": r.added, "error": r.error}
        for r in results
    ]
    _emit(args, data, "\n".join(
        f"[{d['id']}] {d['name']}：" + (f"失败：{d['error']}" if d["error"] else f"新增 {d['added']} 条")
        for d in data) or "暂无监测的群")
    return 1 if any(d["error"] for d in data) else 0


def _timeline(args) -> None:
    with _store() as (store, _):
        rows = store.timeline(args.project, args.group, args.mine, args.limit)
    _emit(args, _rows(rows, drop=("raw",)), "\n".join(_line(r) for r in rows) or "暂无消息")


def _search(args) -> None:
    with _store() as (store, config):
        result = search.messages(store, config, args.query, args.project, args.group, args.cursor, args.limit)
    lines = [f"[{hit['message']['id']}] {hit['message']['group_name']}：{hit['excerpt']}" for hit in result["hits"]]
    _emit(args, result, "\n".join(lines) or "无匹配消息")


def _ai_settings(args) -> None:
    with _store() as (store, _):
        result = ai.settings(store)
    _emit(args, {"settings": result}, json.dumps(result, ensure_ascii=False, indent=2))


def _ai_configure(args) -> None:
    with _store() as (store, _):
        result = ai.configure(store, _json_values(args.values), approve_endpoint=args.approve_endpoint)
    _emit(args, {"settings": result}, "AI 设置已保存，未调用模型")


def _ai_ask(args) -> None:
    with _store() as (store, config):
        result = ai.ask(store, config, args.question, args.project, args.group)
    _emit(args, result, result["answer"])


def _ai_draft(args) -> None:
    with _store() as (store, config):
        result = ai.draft(store, config, args.id, args.instruction)
    _emit(args, result, "待审核草稿（尚未发送）：\n" + result["draft"])


_REASON_LABEL = {"mention": "需回复", "issue": "疑似问题"}


def _awaiting(args) -> None:
    with _store() as (store, config):
        items = attention(store, config, args.project)
    data = [{**{k: a.message[k] for k in a.message.keys() if k not in ("raw", "quoted")},
             "reason": a.reason, "waiting_minutes": a.waiting_minutes, "overdue": a.overdue}
            for a in items]
    _emit(args, data, "\n".join(
        f"[{a.message['id']}] {_REASON_LABEL[a.reason]}{'（超时）' if a.overdue else ''}"
        f" · 已等待 {a.waiting_minutes} 分钟 · {_line(a.message)}"
        for a in items) or "暂无待处理的消息")


def _edit(args) -> None:
    with _store() as (store, config):
        if not args.yes:
            row, plan = actions.plan_edit(store, args.id, args.text)
            _emit(args, {"ok": True, "edited": False, "preview": plan},
                  f"将把 [{args.id}] 「{row['text']}」修改为：\n{plan['text']}\n（加 --yes 确认修改）")
            return
        actions.edit_message(store, lambda s: adapter_for(s, config), args.id, args.text)
    _emit(args, {"ok": True, "edited": True}, "已修改")


def _retract(args) -> None:
    with _store() as (store, config):
        if not args.yes:
            row = store.message(args.id)
            if not row:
                raise ValueError(f"消息 {args.id} 不存在")
            _emit(args, {"ok": True, "retracted": False},
                  f"将撤回 [{args.id}] {row['conversation_name']}：{row['text']}\n（加 --yes 确认撤回）")
            return
        actions.retract_message(store, lambda s: adapter_for(s, config), args.id)
    _emit(args, {"ok": True, "retracted": True}, "已撤回")


def _handle(args) -> None:
    with _store() as (store, _):
        actions.set_handled(store, args.id, not args.undo)
    _emit(args, {"ok": True}, f"已撤销消息 [{args.id}] 的已处理标记" if args.undo
          else f"已将消息 [{args.id}] 标记为已处理")


def _send(args) -> int:
    with _store() as (store, config):
        if args.operation:
            row = store.send_operation(args.operation, "cli")
            if not row or json.loads(row["payload"])["group"] != args.group:
                raise ValueError("发送操作不存在或不属于这个群")
            if not args.yes:
                raise ValueError("确认操作需加 --yes")
            body = {"text": args.text} if args.text is not None else {}
            result = sending.confirm(store, config, lambda s: adapter_for(s, config), "cli", args.operation, body)
        else:
            if args.text is None:
                raise ValueError("缺少 --text 或 --operation")
            plan = sending.preview(store, config, "cli", {
                "group": args.group, "text": args.text, "reply_to": args.reply_to,
                "ai": args.ai, "handle": None})
            if not args.yes:
                _emit(args, {"ok": True, "sent": False, "preview": plan},
                      f"将发送到 {plan['source']} · {plan['group']}（{_KIND_LABEL[plan['kind']]}）：\n{plan['text']}\n"
                      + f"（使用 send {args.group} --operation {plan['operation_id']} --yes 确认；同一编号可安全重试）")
                return 0
            result = sending.confirm(store, config, lambda s: adapter_for(s, config), "cli", plan["operation_id"], {})
    message = ("已发送" + (f"；回读待完成：{result['sync_error']}" if result.get("sync_error") else "")
               if result["sent"] else result["error"])
    _emit(args, {"ok": result["sent"], **result}, message)
    return 0 if result["sent"] else 1


def _log(args) -> None:
    with _store() as (store, _):
        rows, more = logview.query(store, category=args.category, failed=args.failed, actor=args.actor,
                                   search=args.search, since=args.since, before=args.before,
                                   limit=args.limit, noise=not args.quiet)
        entries = [logview.Describer(store)(r) for r in rows]
    lines = [f"#{e['id']} {_local(e['at'])} {'AI' if e['actor'] == 'ai' else '我'}"
             f"{'（AI 身份）' if e['as_ai'] else ''} {e['label']} {e['object']['label']} → {e['outcome']}"
             for e in entries]
    if more:
        lines.append(f"更早的记录：deck log --before {entries[-1]['id']}")
    _emit(args, {"entries": entries, "has_more": more}, "\n".join(lines) or "暂无记录")


def _prune(args) -> None:
    with _store() as (store, config):
        removed = store.prune(config.retention_days)
        store.audit("me", "message.prune", "*", {"days": config.retention_days}, f"removed {removed}")
    _emit(args, {"ok": True, "removed": removed},
          f"已删除 {removed} 条超过 {config.retention_days} 天的消息")


def _watch(args) -> None:
    from .watcher import Watcher

    _trim_logs()
    _interrupt_on_term()
    print("deck 正在监听，按 Ctrl+C 退出", flush=True)
    Watcher(config_module.load()).run_forever()


def _serve(args) -> None:
    from dataclasses import replace

    from .access import addresses
    from .server import make_server
    from .watcher import Watcher

    config = config_module.load()
    settings = replace(config.server, host=args.host or config.server.host,
                       port=args.port or config.server.port)
    config = replace(config, server=settings)
    _trim_logs()
    _interrupt_on_term()
    watcher = None if args.no_watch else Watcher(config)
    # 先占好端口再开监听：端口被占时直接报错退出，不留下 dws 监听进程。
    server = make_server(config, watcher)
    if watcher:
        watcher.start()
    code = None
    # 后台运行（launchd、nohup）时输出会写进日志文件，登录码不落盘。
    if sys.stdout.isatty():
        with _store() as (store, _):
            code, _ = access.create_pairing(store)
    print(_serve_banner(addresses(config), code, watching=bool(watcher)), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if watcher:
            watcher.stop()


def _serve_banner(known: list[dict], code: str | None, watching: bool) -> str:
    local = next(a["url"] for a in known if a["kind"] == "local")
    lines = ["deck 看板已启动" + ("" if watching else "（未启用监听）"),
             f"本机登录（10 分钟内有效，仅可使用一次）：{local}#/login?code={code}" if code
             else f"本机地址：{local}（后台运行不生成登录码；需要登录时运行 deck access link）"]
    others = [a for a in known if a["kind"] != "local"]
    if others:
        lines.append("其他设备可使用以下任一可访问的地址；登录码可在「设置 → 访问 → 添加设备」中获取，或运行 deck access link：")
        lines += [f"  {a['label']}{'' if a['secure'] else '（明文）'}：{a['url']}" for a in others]
    if any(not a["secure"] for a in others):
        lines.append("标记为「明文」的地址不加密，同一网络中的他人可能截获登录信息，建议优先使用 Tailscale 或 HTTPS 中继。")
    return "\n".join(lines)


_LOG_LIMIT = 1 << 20


def _trim_logs() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            _trim_log(stream, _LOG_LIMIT)
        except OSError as error:
            print(f"deck: 日志轮转失败，继续写入原文件：{error}", file=sys.stderr)


def _trim_log(stream, limit: int) -> None:
    """launchd 把输出接到日志文件且不轮转；启动时超过上限就把旧内容移到 .1（只保留一份）再清空。"""
    try:
        fd = stream.fileno()
    except (AttributeError, ValueError, OSError):
        return
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_size <= limit:
        return
    path = _fd_path(fd)
    if not path:
        return
    stream.flush()
    backup = os.open(path + ".1", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(backup, 0o600)
    with open(path, "rb") as source, os.fdopen(backup, "wb") as target:
        shutil.copyfileobj(source, target)
    os.ftruncate(fd, 0)
    os.lseek(fd, 0, os.SEEK_SET)


def _fd_path(fd: int) -> str | None:
    if hasattr(fcntl, "F_GETPATH"):
        return os.fsdecode(fcntl.fcntl(fd, fcntl.F_GETPATH, bytes(1024)).rstrip(b"\0"))
    link = f"/proc/self/fd/{fd}"
    return os.readlink(link) if os.path.exists(link) else None


def _access_setup(args) -> None:
    with _store() as (store, config):
        plan = access.pin_entry(store, config, args.url) if args.yes else access.entry_plan(config, args.url)
    _emit(args, {"saved": args.yes, **plan},
          f"{'已固定' if args.yes else '将固定'}入口：{plan['url']}\n"
          + "网络路由尚未修改；确认影响后才可执行：\n" + (plan["command"] or "现有路由未知，禁止执行")
          + "\n恢复原路由：\n" + (plan["rollback_command"] or "现有路由未知，无法生成恢复命令")
          + "\n" + "\n".join(plan["warnings"]))


def _access_link(args) -> None:
    from .access import addresses

    with _store() as (store, config):
        code, expires = access.create_pairing(store)
        store.audit("me", "access.pairing", "cli", {}, "ok")
    urls = [args.url if args.url.endswith("/") else args.url + "/"] if args.url else [
        a["url"] for a in addresses(config)]
    links = [f"{url}#/login?code={code}" for url in urls]
    _emit(args, {"code": code, "expires_at": expires.isoformat(timespec="seconds"), "links": links},
          f"登录码 {code}（{_local(expires.isoformat())} 前有效，仅可使用一次）\n" + "\n".join(links))


def _access_list(args) -> None:
    with _store() as (store, _):
        rows = access.sessions(store)
    _emit(args, _rows(rows), "\n".join(
        f"[{r['id']}] {'（已禁用）' if r['disabled_at'] else ''}{r['ip']}\t"
        f"最近 {_local(r['last_seen_at'])}\t{r['user_agent'][:60]}"
        for r in rows) or "暂无已登录设备")


def _access_toggle(args) -> None:
    with _store() as (store, _):
        if not access.set_disabled(store, args.id, args.disable):
            raise ValueError(f"设备 {args.id} 不存在")
    _emit(args, {"ok": True}, f"已{'禁用' if args.disable else '启用'}设备：[{args.id}]")


def _access_password(args) -> None:
    if args.clear:
        with _store() as (store, _):
            access.set_local_password(store, None)
        return _emit(args, {"ok": True}, "已清除本机密码")
    import getpass

    password = getpass.getpass(f"本机密码（至少 {access.PASSWORD_MIN} 位）：")
    if len(password) < access.PASSWORD_MIN:
        raise ValueError(f"密码至少 {access.PASSWORD_MIN} 位")
    if getpass.getpass("再输入一次：") != password:
        raise ValueError("两次输入不一致")
    with _store() as (store, _):
        access.set_local_password(store, password)
    _emit(args, {"ok": True}, "已设置本机密码；在本机用 http://127.0.0.1 打开 deck 时可用它登录")


def _access_revoke(args) -> None:
    if args.id is None and not args.all:
        raise ValueError("请指定设备编号，或使用 --all 移除全部设备")
    with _store() as (store, _):
        removed = access.revoke(store, None if args.all else args.id)
    if not removed:
        raise ValueError(f"设备 {args.id} 不存在")
    _emit(args, {"ok": True, "removed": removed}, f"已移除 {removed} 台设备")


def _interrupt_on_term() -> None:
    """被 kill / launchd 停掉时也走 Ctrl+C 的清理，让 dws 监听正常退订。"""

    def handler(*_):
        # 只响应第一次：uv 会把信号再转发一次，第二次会打断正在进行的清理。
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        raise KeyboardInterrupt

    # 后台启动的进程默认忽略 SIGINT，两个都显式接上。
    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)


# --- 辅助 ---


class _store:
    def __enter__(self):
        self.config = config_module.load()
        self.store = Store(self.config.db_path)
        return self.store, self.config

    def __exit__(self, *_):
        self.store.close()


def _call(args) -> None:
    from . import api
    from .health import SourceHealth

    if not args.name:
        ops = [o for o in api.REGISTRY if not o.web_only]
        _emit(args, [{"name": o.name, "level": o.level, "summary": o.summary} for o in ops],
              "\n".join(f"{o.name:<20} {o.level:<5} {o.summary}" for o in ops))
        return
    item = api.find(args.name)
    if not item or item.web_only:
        raise LookupError(f"没有这个操作：{args.name}；运行 deck call 查看全部")
    try:
        params = json.loads(args.params)
    except json.JSONDecodeError:
        raise ValueError("参数须为 JSON 对象") from None
    if not isinstance(params, dict):
        raise ValueError("参数须为 JSON 对象")
    with _store() as (store, config):
        ctx = api.Context(store=store, config=config_module.current(config, store.setting("runtime_config")),
                          health=SourceHealth())
        try:
            result = item.handler(ctx, params)
        except api.ApiError as error:
            raise ValueError(str(error)) from None
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


def _emit(args, data, text: str) -> None:
    if getattr(args, "json", False):
        json.dump(data, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    else:
        print(text)


def _rows(rows, drop: tuple[str, ...] = ()) -> list[dict]:
    return [{k: r[k] for k in r.keys() if k not in drop} for r in rows]


def _local(iso: str) -> str:
    return datetime.fromisoformat(iso).astimezone().strftime("%m-%d %H:%M")


def _line(row) -> str:
    who = "我" if row["is_me"] else row["sender_name"]
    text = summary(row["source"], row["raw"], row["text"])
    return f"#{row['id']} {_local(row['sent_at'])} [{row['conversation_name']}] {who}：{text}"


if __name__ == "__main__":
    sys.exit(main())
