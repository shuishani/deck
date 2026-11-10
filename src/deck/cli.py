import argparse
import json
import signal
import sqlite3
import sys
from datetime import datetime

from . import access, actions
from . import config as config_module
from .adapters import SOURCES, adapter_for
from .awaiting import awaiting
from .runner import ToolError
from .store import Store
from .sync import sync


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        return args.run(args) or 0
    except (FileNotFoundError, ToolError, ValueError) as error:
        _emit(args, {"ok": False, "error": str(error)}, f"错误：{error}")
        return 1
    except sqlite3.IntegrityError:
        _emit(args, {"ok": False, "error": "已经存在"}, "错误：已经存在，不能重复添加")
        return 1


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="deck", description="个人项目与消息中枢")
    parser.add_argument("--json", action="store_true", help="输出 JSON，给脚本和 agent 用")
    sub = parser.add_subparsers(required=True, metavar="命令")

    p = sub.add_parser("init", help="建立 ~/.deck 和配置文件")
    p.add_argument("--dws", help="dws 可执行文件路径")
    p.add_argument("--drlee", help="drlee 可执行文件路径")
    p.set_defaults(run=_init)

    project = sub.add_parser("project", help="项目").add_subparsers(required=True, metavar="操作")
    p = project.add_parser("add", help="登记项目")
    p.add_argument("key", help="简称，如 mx")
    p.add_argument("--name", required=True)
    p.add_argument("--repo", help="代码仓库路径")
    p.set_defaults(run=_project_add)
    project.add_parser("list", help="列出项目").set_defaults(run=_project_list)

    group = sub.add_parser("group", help="监测的群").add_subparsers(required=True, metavar="操作")
    p = group.add_parser("add", help="把一个群加入项目的监测")
    p.add_argument("project")
    p.add_argument("source", choices=SOURCES)
    p.add_argument("query", help="群名或原始 id")
    p.set_defaults(run=_group_add)
    p = group.add_parser("list", help="列出监测的群")
    p.add_argument("--project")
    p.set_defaults(run=_group_list)
    p = group.add_parser("remove", help="不再监测（连同本地消息一起删除）")
    p.add_argument("id", type=int)
    p.set_defaults(run=_group_remove)

    p = sub.add_parser("sync", help="拉取监测群的新消息")
    p.add_argument("--project")
    p.set_defaults(run=_sync)

    p = sub.add_parser("timeline", help="按时间看消息")
    p.add_argument("--project")
    p.add_argument("--group", type=int)
    p.add_argument("--mine", action="store_true", help="只看我发的")
    p.add_argument("--limit", type=int, default=30)
    p.set_defaults(run=_timeline)

    p = sub.add_parser("awaiting", help="@我、还没回的消息")
    p.add_argument("--project")
    p.set_defaults(run=_awaiting)

    p = sub.add_parser("send", help="往监测的群发消息（不加 --yes 只预览）")
    p.add_argument("group", type=int)
    p.add_argument("--text", required=True)
    p.add_argument("--reply-to", help="回复的消息原始 id")
    p.add_argument("--ai", action="store_true", help="以 AI 身份发，开头加 ai_prefix")
    p.add_argument("--yes", action="store_true", help="确认真的发送")
    p.set_defaults(run=_send)

    p = sub.add_parser("log", help="操作日志")
    p.add_argument("--limit", type=int, default=30)
    p.set_defaults(run=_log)

    p = sub.add_parser("prune", help="删除超过保存期限的消息")
    p.set_defaults(run=_prune)

    p = sub.add_parser("watch", help="常驻监听（不开网页）")
    p.set_defaults(run=_watch)

    p = sub.add_parser("serve", help="看板，默认同时常驻监听")
    p.add_argument("--host", help="监听地址，局域网访问用 0.0.0.0（默认取配置，一般是 127.0.0.1）")
    p.add_argument("--port", type=int, help="端口（默认取配置，一般是 8765）")
    p.add_argument("--no-watch", action="store_true", help="只开网页，不监听")
    p.set_defaults(run=_serve)

    access_cmd = sub.add_parser("access", help="谁能登录看板").add_subparsers(
        required=True, metavar="操作")
    p = access_cmd.add_parser("link", help="生成一次性登录链接（10 分钟内有效）")
    p.add_argument("--url", help="只给这个地址生成，如中继地址")
    p.set_defaults(run=_access_link)
    access_cmd.add_parser("list", help="已登录的设备").set_defaults(run=_access_list)
    p = access_cmd.add_parser("revoke", help="移除设备（要重新配对才能再用）")
    p.add_argument("id", nargs="?", type=int)
    p.add_argument("--all", action="store_true", help="所有设备")
    p.set_defaults(run=_access_revoke)
    for name, disable in (("disable", True), ("enable", False)):
        p = access_cmd.add_parser(name, help="禁用设备（保留，可再启用）" if disable else "重新启用设备")
        p.add_argument("id", type=int)
        p.set_defaults(run=_access_toggle, disable=disable)
    return parser


# --- 命令 ---


def _init(args) -> None:
    base = config_module.home()
    path = config_module.init(base, args.dws, args.drlee)
    Store(config_module.load(base).db_path).close()
    _emit(args, {"ok": True, "home": str(base), "config": str(path)}, f"已就绪：{path}")


def _project_add(args) -> None:
    with _store() as (store, _):
        actions.add_project(store, args.key, args.name, args.repo)
    _emit(args, {"ok": True, "project": args.key}, f"已登记项目 {args.key}")


def _project_list(args) -> None:
    with _store() as (store, _):
        rows = store.projects()
    _emit(args, _rows(rows), "\n".join(f"{r['key']}\t{r['name']}\t{r['repo'] or ''}" for r in rows)
          or "还没有项目")


def _group_add(args) -> None:
    with _store() as (store, config):
        row = actions.add_group(store, lambda s: adapter_for(s, config),
                                args.project, args.source, args.query)
    _emit(args, {"ok": True, "id": row["id"], "name": row["name"]},
          f"已监测 [{row['id']}] {row['source']} · {row['name']}")


def _group_list(args) -> None:
    with _store() as (store, _):
        rows = store.conversations(args.project)
    _emit(args, _rows(rows), "\n".join(
        f"[{r['id']}] {r['project']}\t{r['source']}\t{r['name']}" for r in rows) or "还没有监测的群")


def _group_remove(args) -> None:
    with _store() as (store, _):
        row = actions.remove_group(store, args.id)
    _emit(args, {"ok": True}, f"已不再监测 [{args.id}] {row['name']}")


def _sync(args) -> int:
    with _store() as (store, config):
        results = sync(store, lambda source: adapter_for(source, config), args.project)
    data = [
        {"id": r.conversation["id"], "name": r.conversation["name"],
         "added": r.added, "error": r.error}
        for r in results
    ]
    _emit(args, data, "\n".join(
        f"[{d['id']}] {d['name']}：" + (f"失败，{d['error']}" if d["error"] else f"新增 {d['added']} 条")
        for d in data) or "还没有监测的群")
    return 1 if any(d["error"] for d in data) else 0


def _timeline(args) -> None:
    with _store() as (store, _):
        rows = store.timeline(args.project, args.group, args.mine, args.limit)
    _emit(args, _rows(rows, drop=("raw",)), "\n".join(_line(r) for r in rows) or "没有消息")


def _awaiting(args) -> None:
    with _store() as (store, config):
        items = awaiting(store, config, args.project)
    data = [{**{k: a.message[k] for k in a.message.keys() if k != "raw"},
             "waiting_minutes": a.waiting_minutes, "overdue": a.overdue} for a in items]
    _emit(args, data, "\n".join(
        f"{'⚠ ' if a.overdue else ''}等 {a.waiting_minutes} 分钟 · {_line(a.message)}"
        for a in items) or "没有待回复的消息")


def _send(args) -> int:
    with _store() as (store, config):
        if not args.yes:
            row, plan = actions.plan_send(store, config, args.group, args.text,
                                          args.reply_to, args.ai)
            _emit(args, {"ok": True, "sent": False, "preview": plan},
                  f"将发到 {row['source']} · {row['name']}：\n{plan['text']}\n（加 --yes 才会真的发送）")
            return 0
        actions.send(store, config, lambda s: adapter_for(s, config), args.group,
                     args.text, args.reply_to, args.ai)
    _emit(args, {"ok": True, "sent": True}, "已发送")
    return 0


def _log(args) -> None:
    with _store() as (store, _):
        rows = store.audit_log(args.limit)
    _emit(args, _rows(rows), "\n".join(
        f"{_local(r['at'])} {r['actor']} {r['action']} {r['target']} → {r['result']}"
        for r in rows) or "没有记录")


def _prune(args) -> None:
    with _store() as (store, config):
        removed = store.prune(config.retention_days)
        store.audit("me", "message.prune", "*", {"days": config.retention_days}, f"removed {removed}")
    _emit(args, {"ok": True, "removed": removed},
          f"删除了 {removed} 条超过 {config.retention_days} 天的消息")


def _watch(args) -> None:
    from .watcher import Watcher

    _interrupt_on_term()
    print("deck 正在监听，Ctrl+C 退出", flush=True)
    Watcher(config_module.load()).run_forever()


def _serve(args) -> None:
    from dataclasses import replace

    from .server import addresses, make_server
    from .watcher import Watcher

    config = config_module.load()
    settings = replace(config.server, host=args.host or config.server.host,
                       port=args.port or config.server.port)
    config = replace(config, server=settings)
    _interrupt_on_term()
    watcher = None if args.no_watch else Watcher(config)
    # 先占好端口再开监听：端口被占时直接报错退出，不留下 dws 监听进程。
    server = make_server(config, watcher)
    if watcher:
        watcher.start()
    with _store() as (store, _):
        code, _ = access.create_pairing(store)
    known = addresses(config)
    local = next(a["url"] for a in known if a["kind"] == "local")
    lines = ["deck 看板已启动" + ("" if watcher else "（未开监听）"),
             f"本机登录（10 分钟内有效、只能用一次）：{local}#/login?code={code}"]
    others = [a for a in known if a["kind"] != "local"]
    if others:
        lines.append("其他设备用下面任一能打开的地址；登录码在 设置 → 访问 → 添加设备，或运行 deck access link：")
        lines += [f"  {a['label']}{'' if a['secure'] else '（明文）'}：{a['url']}" for a in others]
    if any(not a["secure"] for a in others):
        lines.append("标「明文」的地址在网络上不加密，同一网络的人可能截获登录信息；优先用 Tailscale 或 HTTPS 中继。")
    print("\n".join(lines), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if watcher:
            watcher.stop()


def _access_link(args) -> None:
    from .server import addresses

    with _store() as (store, config):
        code, expires = access.create_pairing(store)
        store.audit("me", "access.pairing", "cli", {}, "ok")
    urls = [args.url if args.url.endswith("/") else args.url + "/"] if args.url else [
        a["url"] for a in addresses(config)]
    links = [f"{url}#/login?code={code}" for url in urls]
    _emit(args, {"code": code, "expires_at": expires.isoformat(timespec="seconds"), "links": links},
          f"登录码 {code}（{_local(expires.isoformat())} 前有效，只能用一次）\n" + "\n".join(links))


def _access_list(args) -> None:
    with _store() as (store, _):
        rows = access.sessions(store)
    _emit(args, _rows(rows), "\n".join(
        f"[{r['id']}] {'（已禁用）' if r['disabled_at'] else ''}{r['ip']}\t"
        f"最近 {_local(r['last_seen_at'])}\t{r['user_agent'][:60]}"
        for r in rows) or "没有已登录的设备")


def _access_toggle(args) -> None:
    with _store() as (store, _):
        if not access.set_disabled(store, args.id, args.disable):
            raise ValueError(f"没有编号 {args.id} 的设备")
    _emit(args, {"ok": True}, f"已{'禁用' if args.disable else '启用'}设备 [{args.id}]")


def _access_revoke(args) -> None:
    if args.id is None and not args.all:
        raise ValueError("给出设备编号，或用 --all 移除所有设备")
    with _store() as (store, _):
        removed = access.revoke(store, None if args.all else args.id)
    if not removed:
        raise ValueError(f"没有编号 {args.id} 的设备")
    _emit(args, {"ok": True, "removed": removed}, f"已让 {removed} 个设备退出登录")


def _interrupt_on_term() -> None:
    """被 kill / launchd 停掉时也走 Ctrl+C 的清理，让 dws 监听正常退订。"""

    def handler(*_):
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
    text = row["text"].replace("\n", " ")
    return f"{_local(row['sent_at'])} [{row['conversation_name']}] {who}：{text}"


if __name__ == "__main__":
    sys.exit(main())
