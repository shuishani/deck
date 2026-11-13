"""对外操作的统一注册表：网页接口、`deck call` 命令行、`deck mcp` 都从这里取。

每个操作只定义一次：名称、方法和路径、权限等级、说明和处理函数。处理函数只接收
Context 和合并后的参数（路径参数 > 请求体 > 查询参数），返回可 JSON 化的 dict。
写操作统一调用 actions / access / ai / sending / uploads 这些业务模块，操作日志也在那里记。
"""
import re
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any, Callable, Literal

from ..adapters import adapter_for
from ..config import Config
from ..health import SourceHealth
from ..store import Store

# read：只读；write：改本地数据；send：会改动外部平台（发消息、撤回、编辑），须先预览再确认。
Level = Literal["read", "write", "send"]


class ApiError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status = status
        self.extra = extra


def not_found(message: str) -> ApiError:
    return ApiError(HTTPStatus.NOT_FOUND, message)


@dataclass
class Context:
    store: Store
    config: Config
    watcher: Any = None
    health: SourceHealth | None = None
    session: dict | None = None
    # 网页请求的处理器：登录、上传等只在网页可用的操作要读 Cookie、原始请求体。
    http: Any = None
    cookies: list[str] = field(default_factory=list)

    def adapter_for(self, source: str):
        return adapter_for(source, self.config)

    @property
    def owner(self) -> str:
        """待确认的发送、上传的附件归谁：网页按登录设备，其余按入口。"""
        return f"session:{self.session['id']}" if self.session else self.store.via

    def wake_watcher(self) -> None:
        if self.watcher:
            self.watcher.wake()


@dataclass(frozen=True)
class Op:
    name: str
    method: str
    pattern: re.Pattern
    handler: Callable[[Context, dict], Any]
    level: Level
    summary: str
    # 不登录也能调用。
    open: bool = False
    # 依赖浏览器会话或原始请求（Cookie、上传的文件流），不给命令行和 MCP。
    web_only: bool = False
    # 请求体是文件原始内容，不按 JSON 解析。
    raw_body: bool = False
    # 参数说明，见 schema()。
    params: dict[str, str] = field(default_factory=dict)


REGISTRY: list[Op] = []


def op(name: str, method: str, path: str, level: Level, summary: str, *,
       open: bool = False, web_only: bool = False, raw_body: bool = False, params: dict[str, str] | None = None):
    def register(handler):
        if any(o.name == name for o in REGISTRY):
            raise ValueError(f"操作重名：{name}")
        REGISTRY.append(Op(name, method, re.compile(path), handler, level, summary, open, web_only, raw_body,
                           params or {}))
        return handler
    return register


PROJECT = "string 项目 key（projects_list 里的 key）"


def required(params: dict[str, str]) -> list[str]:
    return [key[:-1] for key in params if key.endswith("*")]


def schema(params: dict[str, str]) -> dict:
    """参数说明转 JSON Schema：键以 * 结尾为必填；值是「类型 说明」，类型后加 [] 表示数组。"""
    properties = {}
    for key, spec in params.items():
        kind, _, description = spec.partition(" ")
        item = kind.removesuffix("[]")
        shape = {"type": "array", "items": {"type": item}} if item != kind else {"type": kind}
        properties[key.removesuffix("*")] = {**shape, "description": description}
    return {"type": "object", "properties": properties, "required": required(params)}


def resolve(method: str, path: str) -> tuple[Op, dict[str, str]] | None:
    for item in REGISTRY:
        if item.method == method and (m := item.pattern.fullmatch(path)):
            return item, m.groupdict()
    return None


def find(name: str) -> Op | None:
    return next((o for o in REGISTRY if o.name == name), None)


def int_arg(args: dict, key: str, default=None):
    try:
        return int(args[key])
    except (KeyError, TypeError, ValueError):
        return default


def bool_arg(args: dict, key: str, default: bool = False) -> bool:
    """网页查询参数是 "1"/"0"，命令行和 MCP 传 JSON 布尔值。"""
    value = args.get(key, default)
    return value if isinstance(value, bool) else str(value).lower() in ("1", "true")


def required_int(args: dict, key: str) -> int:
    value = int_arg(args, key)
    if value is None:
        raise ValueError(f"缺少 {key}")
    return value


# 注册各领域的操作；放在最后，它们会引用上面的定义。
from . import devices, groups, messages, notify, system, tasks  # noqa: E402, F401
