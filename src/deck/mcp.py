"""MCP 服务（stdio）：把操作注册表里允许 agent 用的操作包成工具，不另写业务逻辑。

只读操作全部开放；写操作只开放只改本地、能在看板上改回来的。删群、改设置、群类型和提醒规则、
项目、暂停平台不开放。发送、编辑、撤回各拆成 _preview 和 _confirm 两个工具：确认工具的参数带着
群名和正文，客户端请用户批准时（包括转到手机上的）能直接看到要发什么。
"""
import json
import sqlite3
import sys
import traceback
from dataclasses import dataclass
from importlib.metadata import version
from typing import Any, BinaryIO, Callable

from . import api
from . import config as config_module
from .config import Config
from .health import SourceHealth
from .runner import ToolError
from .store import Store

PROTOCOLS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
WRITES = ("messages.handled", "groups.read", "tasks.create", "tasks.link", "tasks.unlink",
          "tasks.update", "tasks.remove", "sync")
SENDS = ("messages.send", "messages.edit", "messages.retract")
INSTRUCTIONS = (
    "deck 是个人的消息与项目中枢：钉钉、channel 的群消息，以及项目和任务。"
    "先用 overview 或 messages_attention 了解情况。"
    "发送、编辑、撤回都分两步：先调用 *_preview，把预览里的群名、正文和提示原样告诉用户；"
    "用户明确同意后再调用对应的 *_confirm，参数与预览时一致。不要替用户决定发送。"
)


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    params: dict[str, str]
    annotations: dict[str, bool]
    call: Callable[[api.Context, dict], Any]

    def spec(self) -> dict:
        return {"name": self.name, "description": self.description,
                "inputSchema": api.schema(self.params), "annotations": self.annotations}


def tools() -> dict[str, Tool]:
    found: list[Tool] = []
    for item in api.REGISTRY:
        name = item.name.replace(".", "_")
        if item.web_only:
            continue
        if item.level == "read":
            found.append(Tool(name, item.summary, item.params,
                              {"readOnlyHint": True, "openWorldHint": False}, item.handler))
        elif item.name in WRITES:
            found.append(Tool(name, item.summary, item.params,
                              {"readOnlyHint": False, "destructiveHint": item.name == "tasks.remove",
                               "openWorldHint": item.name == "sync"}, item.handler))
        elif item.name in SENDS:
            found.extend(_two_step(item, name))
    return {t.name: t for t in found}


def _two_step(item: api.Op, name: str) -> tuple[Tool, Tool]:
    verb = item.summary.split("：")[0]
    preview = Tool(
        f"{name}_preview",
        f"{verb}——只生成预览，不会改动平台。把预览原样告诉用户，用户同意后再调用 {name}_confirm。",
        item.params, {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
        lambda ctx, args: item.handler(ctx, {**args, "confirm": False}))
    params = {**item.params,
              "group_name*": "string 预览返回的 group（群名），用来核对",
              "prod": "boolean 预览里 kind 为 prod（正式群）时必须为 true"}
    if item.name == "messages.send":
        params = {"operation_id*": "string 预览返回的 operation_id", **params}

    def confirm(ctx, args):
        plan = _sent_plan(ctx, args) if item.name == "messages.send" else \
            item.handler(ctx, {**args, "confirm": False})["preview"]
        if args.get("group_name") != plan["group"]:
            raise ValueError(f"group_name 与预览不一致，应为「{plan['group']}」；请重新预览并请用户核对")
        if plan["kind"] == "prod" and args.get("prod") is not True:
            raise ValueError("这是正式群，须传 prod=true，并确认用户知道会发到正式群")
        body = {k: v for k, v in args.items() if k not in ("group_name", "prod")}
        return item.handler(ctx, {**body, "confirm": True})

    return preview, Tool(
        f"{name}_confirm",
        f"{verb}——真正改动平台，群内成员可见。参数须与预览时一致，group_name 填预览里的 group；"
        "正式群（kind 为 prod）还须传 prod=true。",
        params, {"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True}, confirm)


def _sent_plan(ctx: api.Context, args: dict) -> dict:
    row = ctx.store.send_operation(str(args.get("operation_id", "")), ctx.owner)
    if not row:
        raise LookupError("发送草稿不存在，请重新预览")
    return json.loads(row["preview"])


class _RpcError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


class Server:
    def __init__(self, store: Store, config: Config):
        self.store = store
        self.config = config
        self.health = SourceHealth()
        self.tools = tools()

    def handle(self, message: Any) -> dict | None:
        if not isinstance(message, dict):
            return _error(None, -32600, "无效请求")
        # 通知和客户端的应答不用回复。
        if "id" not in message or "method" not in message:
            return None
        try:
            result = self._dispatch(message["method"], message.get("params") or {})
        except _RpcError as error:
            return _error(message["id"], error.code, str(error))
        return {"jsonrpc": "2.0", "id": message["id"], "result": result}

    def _dispatch(self, method: str, params: dict) -> dict:
        if method == "initialize":
            requested = params.get("protocolVersion")
            return {"protocolVersion": requested if requested in PROTOCOLS else PROTOCOLS[0],
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "deck", "version": version("deck")},
                    "instructions": INSTRUCTIONS}
        if method == "ping":
            return {}
        if method == "tools/list":
            return {"tools": [t.spec() for t in self.tools.values()]}
        if method == "tools/call":
            tool = self.tools.get(params.get("name"))
            args = params.get("arguments") or {}
            if not tool:
                raise _RpcError(-32602, f"没有这个工具：{params.get('name')}")
            if not isinstance(args, dict):
                raise _RpcError(-32602, "arguments 须为对象")
            return self._call(tool, args)
        raise _RpcError(-32601, f"不支持的方法：{method}")

    def _call(self, tool: Tool, args: dict) -> dict:
        missing = [k for k in api.required(tool.params) if k not in args]
        if missing:
            return _text(f"缺少参数：{'、'.join(missing)}", error=True)
        ctx = api.Context(store=self.store, health=self.health,
                          config=config_module.current(self.config, self.store.setting("runtime_config")))
        try:
            result = tool.call(ctx, args)
        except (api.ApiError, ValueError, LookupError, ToolError) as error:
            return _text(str(error), error=True)
        except sqlite3.IntegrityError:
            return _text("记录已存在", error=True)
        except Exception as error:  # noqa: BLE001 - 一次调用出错不能拖垮整个会话。
            traceback.print_exc(file=sys.stderr)
            return _text(f"内部错误：{type(error).__name__}", error=True)
        return _text(json.dumps(result, ensure_ascii=False, indent=2))


def _text(text: str, error: bool = False) -> dict:
    return {"content": [{"type": "text", "text": text}], "isError": error}


def _error(id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}


def run(server: Server, stdin: BinaryIO, stdout: BinaryIO) -> None:
    for line in stdin:
        if not line.strip():
            continue
        try:
            reply = server.handle(json.loads(line))
        except (UnicodeDecodeError, json.JSONDecodeError):
            reply = _error(None, -32700, "无法解析的 JSON")
        if reply is not None:
            stdout.write(json.dumps(reply, ensure_ascii=False).encode() + b"\n")
            stdout.flush()


def serve() -> None:
    config = config_module.load()
    out = sys.stdout.buffer
    # stdout 只留给协议；其他地方的打印改到 stderr，免得把消息流写坏。
    sys.stdout = sys.stderr
    store = Store(config.db_path, via="mcp")
    try:
        run(Server(store, config), sys.stdin.buffer, out)
    finally:
        store.close()
