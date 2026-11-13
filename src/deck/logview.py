"""操作日志的展示：中文动作名、分类、结果、对象名称。网页和 CLI 共用。"""

import json
import re
import sqlite3

from .store import Store

LABELS = {
    "message.send": "发送消息",
    "message.edit": "编辑消息",
    "message.retract": "撤回消息",
    "message.handle": "标记已处理",
    "message.unhandle": "撤销已处理",
    "message.prune": "清理过期消息",
    "upload.add": "暂存附件",
    "task.add": "创建任务",
    "task.update": "更新任务",
    "task.remove": "删除任务",
    "task.link": "消息加入任务",
    "task.unlink": "消息移出任务",
    "project.add": "登记项目",
    "project.update": "修改项目",
    "group.add": "添加监测群",
    "group.remove": "移除监测群",
    "group.kind": "设置群类型",
    "group.move": "调整群所属项目",
    "group.rules": "修改群提醒规则",
    "group.mode": "修改会话状态",
    "notify.settings": "修改推送设置",
    "notify.webhook": "保存推送机器人",
    "notify.test": "发送推送测试",
    "source.pause": "暂停平台监听",
    "source.resume": "恢复平台监听",
    "config.update": "修改消息与提醒设置",
    "ai.ask": "AI 问答",
    "ai.settings": "修改 AI 设置",
    "access.login": "设备登录",
    "access.pairing": "生成登录码",
    "access.disable": "禁用设备",
    "access.enable": "启用设备",
    "access.revoke": "移除设备",
    "access.password": "设置本机密码",
    "access.password_login": "本机密码登录",
    "access.entry": "固定访问入口",
}

CATEGORIES = {
    "message": ("消息", ("message.send", "message.edit", "message.retract", "message.handle",
                        "message.unhandle", "upload.")),
    "task": ("任务", ("task.",)),
    "group": ("群与项目", ("group.", "project.")),
    "ai": ("AI", ("ai.",)),
    "access": ("访问", ("access.",)),
    "system": ("监听与设置", ("source.", "config.", "notify.", "message.prune")),
}

# 数量多、价值低，网页默认不显示。
NOISE = ("access.pairing", "source.pause", "source.resume")

_SOURCES = {"dingtalk": "钉钉", "channel": "channel"}
_PATH = re.compile(r"(?:/[^\s/：:]+)+/([^\s/：:]+)")


def query(store: Store, *, category: str | None = None, failed: bool = False, actor: str | None = None,
          search: str = "", since: str | None = None, before: int | None = None, limit: int = 50,
          noise: bool = True) -> tuple[list[sqlite3.Row], bool]:
    if category and category not in CATEGORIES:
        raise ValueError(f"分类须为 {' / '.join(CATEGORIES)} 之一")
    if actor not in (None, "me", "ai"):
        raise ValueError("执行者须为 me 或 ai")
    return store.audit_query(prefixes=CATEGORIES[category][1] if category else (),
                             exclude=() if noise else NOISE, failed=failed, actor=actor,
                             search=search.strip(), since=since, before=before, limit=max(1, min(limit, 200)))


def category_of(action: str) -> str | None:
    return next((key for key, (_, prefixes) in CATEGORIES.items()
                 if any(action.startswith(p) for p in prefixes)), None)


def outcome(result: str) -> tuple[str, str]:
    """(ok | error, 给人看的结果)；失败原因去掉本机路径。"""
    if result == "ok":
        return "ok", "成功"
    if result.startswith("error"):
        reason = _PATH.sub(r"\1", result.removeprefix("error").lstrip(": ").strip())
        # 「drlee --json channel 失败：原因」只留工具名和原因。
        if match := re.match(r"(\S+)(?: \S+)* 失败：(.+)", reason, re.S):
            reason = f"{match[1]}：{match[2]}"
        return "error", f"失败：{reason}" if reason else "失败"
    if match := re.fullmatch(r"removed (\d+)", result):
        return "ok", f"已移除 {match[1]} 项"
    return "ok", {"set": "已设置", "cleared": "已清除"}.get(result, result)


class Describer:
    """把日志对象（群的平台 id、任务编号、项目简称……）换成名字；一次请求内缓存。"""

    def __init__(self, store: Store):
        self.store = store
        conversations = store.conversations()
        self.by_remote = {f"{r['source']}:{r['remote_id']}": r for r in conversations}
        self.by_id = {str(r["id"]): r for r in conversations}
        self.projects = {r["key"]: r["name"] for r in store.projects()}

    def __call__(self, row: sqlite3.Row) -> dict:
        try:
            detail = json.loads(row["detail"])
        except ValueError:
            detail = {"内容": row["detail"]}
        status, text = outcome(row["result"])
        action = row["action"]
        # 以前「以 AI 身份发送」记成执行者 ai；deck 的 AI 没有发送权限，这些都是我发的。
        as_ai = bool(detail.get("ai")) or (row["actor"] == "ai" and action.startswith("message."))
        return {
            "id": row["id"], "at": row["at"], "action": action, "label": LABELS.get(action, action),
            "category": category_of(action), "actor": "me" if as_ai else row["actor"], "as_ai": as_ai,
            "via": row["via"],
            "status": status, "outcome": text, "result": row["result"],
            "target": row["target"], "object": self._object(action, row["target"], detail), "detail": detail,
        }

    def _object(self, action: str, target: str, detail: dict) -> dict:
        group = self.by_remote.get(target) if action.startswith(("group.", "message.")) else None
        if action in ("group.move", "group.rules"):
            group = self.by_id.get(target)
        if group:
            return {"kind": "group", "id": group["id"], "label": group["name"]}
        # 消息类的对象可能是消息本身，只记了群名；群类的找不到说明群已被移除。
        if action.startswith("message.") and detail.get("group"):
            return {"kind": "none", "id": None, "label": detail["group"]}
        if action.startswith("group.") and detail.get("name"):
            return {"kind": "none", "id": None, "label": f"{detail['name']}（已移除）"}
        if action.startswith("task."):
            id = int(target.removeprefix("task:")) if target.removeprefix("task:").isdigit() else None
            task = self.store.task(id) if id else None
            if task:
                return {"kind": "task", "id": id, "label": task["title"]}
            return {"kind": "task", "id": None, "label": f"{detail.get('title', target)}（已删除）"}
        if action.startswith("project."):
            return {"kind": "project", "id": target, "label": self.projects.get(target, target)}
        if action.startswith("source."):
            return {"kind": "source", "id": target, "label": _SOURCES.get(target, target)}
        if action == "message.prune":
            return {"kind": "none", "id": None, "label": "全部群"}
        if action.startswith("message."):
            return {"kind": "none", "id": None, "label": "消息"}
        if action == "upload.add":
            return {"kind": "none", "id": None, "label": detail.get("name") or "附件"}
        if action == "ai.ask":
            return {"kind": "project" if target in self.projects else "none", "id": target,
                    "label": self.projects.get(target, "不带数据")}
        if action.startswith("access."):
            label = {"cli": "命令行", "local": "本机", "all": "全部设备"}.get(target)
            if not label:
                label = f"设备 #{target}" if target.isdigit() else target
            return {"kind": "device", "id": None, "label": label}
        if action in ("config.update", "ai.settings") or action.startswith("notify."):
            return {"kind": "none", "id": None, "label": "设置"}
        return {"kind": "none", "id": None, "label": target}
