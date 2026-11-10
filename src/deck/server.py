import fnmatch
import json
import mimetypes
import re
import sqlite3
import ssl
from datetime import datetime
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import access, actions
from .adapters import SOURCES, adapter_for
from .awaiting import awaiting
from .config import Config
from .runner import ToolError
from .store import Store
from .sync import sync
from .watcher import Watcher

STATIC = Path(__file__).parent / "static"
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")
LOOPBACK = {"127.0.0.1", "localhost", "::1"}
# 不登录也能用的接口：查登录状态、用登录码登录。
_OPEN = {("GET", "/api/auth"), ("POST", "/api/session")}


class ApiError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status = status
        self.extra = extra


def make_server(config: Config, watcher: Watcher | None) -> ThreadingHTTPServer:
    settings = config.server
    handler = type("Handler", (_Handler,), {
        "config": config, "watcher": watcher, "limiter": access.FailureLimiter(),
        "tls": bool(settings.tls_cert and settings.tls_key),
    })
    server = ThreadingHTTPServer((settings.host, settings.port), handler)
    server.daemon_threads = True
    if handler.tls:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(settings.tls_cert, settings.tls_key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


def addresses(config: Config) -> list[dict]:
    """能打开看板的地址，带一句状态；recommended 是二维码该用的那个。

    Tailscale 在外面和同一 Wi-Fi 下都通，但手机上的 Tailscale 没连时打不开，
    这时退到局域网。本机放最后。
    """
    settings = config.server
    tls = bool(settings.tls_cert and settings.tls_key)
    scheme = "https" if tls else "http"
    order = {"tailscale": 0, "relay": 1, "lan": 2, "other": 3, "local": 4}
    result = [{"kind": "relay", "label": "中继", "url": url if url.endswith("/") else url + "/",
               "secure": url.startswith("https://"), "status": "从任何网络都能打开",
               "usable": True} for url in settings.public_urls]
    if settings.host not in LOOPBACK:
        tailscale = access.tailscale_status()
        for ip, iface in access.local_interfaces():
            kind, label, encrypted = access.describe(ip, iface)
            entry = {"kind": kind, "label": label, "url": f"{scheme}://{ip}:{settings.port}/",
                     "secure": tls or encrypted, "usable": True, "status": ""}
            if kind == "tailscale":
                online = (tailscale or {}).get("phones_online") or []
                entry["usable"] = bool(online)
                entry["status"] = (f"{'、'.join(online)} 在线" if online
                                   else "手机上的 Tailscale 没连接")
            elif kind == "lan":
                entry["status"] = "同一 Wi-Fi 下可用"
            else:
                entry["status"] = "其他网卡（如公司 VPN）"
            result.append(entry)
    result.append({"kind": "local", "label": "本机", "url": f"{scheme}://127.0.0.1:{settings.port}/",
                   "secure": True, "usable": True, "status": "只在这台电脑上"})
    result.sort(key=lambda a: order[a["kind"]])
    remote = [a for a in result if a["kind"] != "local"]
    best = next((a for a in remote if a["usable"] and a["kind"] in ("tailscale", "relay")), None)
    best = best or next((a for a in remote if a["kind"] == "lan"), None) or (remote or result)[0]
    for entry in result:
        entry["recommended"] = entry is best
    return result


class _Handler(BaseHTTPRequestHandler):
    config: Config
    watcher: Watcher | None
    limiter: access.FailureLimiter
    tls: bool
    server_version = "deck"

    def log_message(self, format, *args):  # noqa: A002 - 只在出错时打印
        pass

    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle()

    def do_DELETE(self):
        self._handle()

    def _handle(self) -> None:
        self._cookies: list[str] = []
        if not self._host_allowed():
            host = self._hostname()
            return self._json(HTTPStatus.FORBIDDEN, {
                "error": f"不认识的访问地址 {host}；如果是你的中继域名，把它加进"
                         " ~/.deck/config.toml 的 [server] allowed_hosts"})
        url = urlparse(self.path)
        # 中继可能把看板挂在子路径下（/deck/api/...），按最后的 /api/ 切出接口路径。
        at = url.path.rfind("/api/")
        if at < 0:
            if self.command != "GET":
                return self._json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "不支持"})
            return self._static(url.path)
        path = url.path[at:]
        # 改数据的请求要自定义头：别的网页没法跨站带上它。
        if self.command != "GET" and self.headers.get("X-Deck") != "1":
            return self._json(HTTPStatus.FORBIDDEN, {"error": "缺少 X-Deck 请求头"})
        store = Store(self.config.db_path)
        try:
            self._session = access.session_for(store, self._cookie(), self._client_ip())
            if (self.command, path) not in _OPEN and not self._session:
                raise ApiError(HTTPStatus.UNAUTHORIZED, "需要登录", auth=True)
            status, body = HTTPStatus.OK, self._route(store, path, parse_qs(url.query))
        except ApiError as error:
            status, body = error.status, {"error": str(error), **error.extra}
        except (ValueError, ToolError) as error:
            status, body = HTTPStatus.BAD_REQUEST, {"error": str(error)}
        except sqlite3.IntegrityError:
            status, body = HTTPStatus.CONFLICT, {"error": "已经存在，不能重复添加"}
        finally:
            store.close()
        self._json(status, body)

    def _route(self, store: Store, path: str, query: dict) -> dict:
        method = self.command
        q = {k: v[-1] for k, v in query.items()}
        if (method, path) == ("GET", "/api/auth"):
            return {"authenticated": bool(self._session)}
        if (method, path) == ("POST", "/api/session"):
            return self._login(store, self._body())
        if (method, path) == ("DELETE", "/api/session"):
            access.revoke(store, self._session["id"])
            self._cookies.append(self._session_cookie("", max_age=0))
            return {"ok": True}
        if (method, path) == ("GET", "/api/access"):
            return {
                "sessions": [{**dict(r), "current": r["id"] == self._session["id"]}
                             for r in access.sessions(store)],
                "addresses": addresses(self.config),
                "tls": self.tls,
            }
        if method == "DELETE" and (m := re.fullmatch(r"/api/sessions/(\d+)", path)):
            if not access.revoke(store, int(m[1])):
                raise ApiError(HTTPStatus.NOT_FOUND, "没有这个设备")
            if int(m[1]) == self._session["id"]:
                self._cookies.append(self._session_cookie("", max_age=0))
            return {"ok": True}
        if method == "POST" and (m := re.fullmatch(r"/api/sessions/(\d+)/(disable|enable)", path)):
            id, disable = int(m[1]), m[2] == "disable"
            if disable and id == self._session["id"]:
                raise ValueError("不能禁用正在用的这台设备；要离开请用「退出登录」")
            if not access.set_disabled(store, id, disable):
                raise ApiError(HTTPStatus.NOT_FOUND, "没有这个设备")
            return {"ok": True}
        if (method, path) == ("POST", "/api/pairings"):
            code, expires = access.create_pairing(store)
            store.audit("me", "access.pairing", self._client_ip(), {}, "ok")
            return {"code": code, "expires_at": expires.isoformat(timespec="seconds")}
        if (method, path) == ("GET", "/api/version"):
            return {"version": store.version()}
        if (method, path) == ("GET", "/api/config"):
            c = self.config
            return {"ai_prefix": c.ai_prefix, "retention_days": c.retention_days,
                    "reply_reminder_hours": c.reply_reminder_hours, "sources": list(SOURCES)}
        if (method, path) == ("GET", "/api/overview"):
            return self._overview(store)
        if (method, path) == ("GET", "/api/timeline"):
            return self._timeline(store, q)
        if (method, path) == ("GET", "/api/awaiting"):
            # 等得最久的在前。
            return {"messages": [
                {**_message(a.message, awaiting=True), "waiting_minutes": a.waiting_minutes,
                 "overdue": a.overdue}
                for a in awaiting(store, self.config, q.get("project") or None)
            ]}
        if (method, path) == ("GET", "/api/projects"):
            return {"projects": [_project(r) for r in store.projects()]}
        if (method, path) == ("POST", "/api/projects"):
            body = self._body()
            actions.add_project(store, str(body.get("key", "")), str(body.get("name", "")),
                                body.get("repo"))
            return {"key": body["key"]}
        if (method, path) == ("GET", "/api/groups"):
            return {"groups": [self._group(r) for r in store.conversations()]}
        if (method, path) == ("POST", "/api/groups"):
            body = self._body()
            row = actions.add_group(store, self._adapter_for, str(body.get("project", "")),
                                    str(body.get("source", "")), str(body.get("query", "")))
            return {"id": row["id"], "name": row["name"]}
        if method == "DELETE" and (m := re.fullmatch(r"/api/groups/(\d+)", path)):
            actions.remove_group(store, int(m[1]))
            return {"ok": True}
        if (method, path) == ("POST", "/api/sync"):
            body = self._body()
            results = sync(store, self._adapter_for, body.get("project") or None)
            return {"results": [{"id": r.conversation["id"], "name": r.conversation["name"],
                                 "added": r.added, "error": r.error} for r in results]}
        if (method, path) == ("POST", "/api/send"):
            return self._send(store, self._body())
        if (method, path) == ("GET", "/api/log"):
            return {"entries": [dict(r) for r in store.audit_log(_int(q.get("limit"), 100))]}
        raise ApiError(HTTPStatus.NOT_FOUND, "没有这个接口")

    def _overview(self, store: Store) -> dict:
        midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
        stats = store.group_stats(midnight)
        waiting: dict[int, int] = {}
        for item in awaiting(store, self.config):
            waiting[item.message["conversation"]] = waiting.get(item.message["conversation"], 0) + 1
        projects = []
        for project in store.projects():
            groups = []
            for row in store.conversations(project["key"]):
                stat = stats.get(row["id"], {})
                last = stat.get("last_message")
                groups.append({
                    **self._group(row),
                    "today_count": stat.get("today_count", 0),
                    "awaiting_count": waiting.get(row["id"], 0),
                    "last_message": last and {
                        "sender_name": last["sender_name"], "is_me": bool(last["is_me"]),
                        "text": last["text"], "sent_at": last["sent_at"]},
                })
            projects.append({**_project(project), "groups": groups,
                             "awaiting_count": sum(g["awaiting_count"] for g in groups)})
        return {"projects": projects}

    def _timeline(self, store: Store, q: dict) -> dict:
        limit = min(_int(q.get("limit"), 50), 200)
        rows = store.timeline(
            project=q.get("project") or None,
            conversation=_int(q.get("group"), None),
            mine=q.get("mine") in ("1", "true"),
            limit=limit + 1,
            before=_int(q.get("before"), None),
        )
        has_more = len(rows) > limit
        rows = rows[1:] if has_more else rows
        ids = {a.message["id"] for a in awaiting(store, self.config, q.get("project") or None)}
        return {"messages": [_message(r, r["id"] in ids) for r in rows], "has_more": has_more}

    def _send(self, store: Store, body: dict) -> dict:
        group = _int(body.get("group"), None)
        if group is None:
            raise ValueError("缺少 group")
        text, reply_to, ai = str(body.get("text", "")), body.get("reply_to") or None, bool(body.get("ai"))
        if not body.get("confirm"):
            _, plan = actions.plan_send(store, self.config, group, text, reply_to, ai)
            return {"preview": plan}
        actions.send(store, self.config, self._adapter_for, group, text, reply_to, ai)
        return {"sent": True}

    def _group(self, row) -> dict:
        mode, listen_error = self.watcher.status(row["id"]) if self.watcher else ("poll", None)
        return {
            "id": row["id"], "project": row["project"], "source": row["source"],
            "name": row["name"], "remote_id": row["remote_id"], "added_at": row["added_at"],
            "watch": {"mode": mode, "last_sync_at": row["last_sync_at"],
                      "error": row["last_error"] or listen_error},
        }

    def _adapter_for(self, source: str):
        return adapter_for(source, self.config)

    # --- 登录 ---

    def _login(self, store: Store, body: dict) -> dict:
        ip = self._client_ip()
        if self.limiter.blocked(ip):
            raise ApiError(HTTPStatus.TOO_MANY_REQUESTS, "尝试太多次，请 10 分钟后再试")
        token = access.redeem(store, str(body.get("code", "")),
                              self.headers.get("User-Agent", ""), ip)
        if not token:
            self.limiter.fail(ip)
            raise ApiError(HTTPStatus.UNAUTHORIZED, "登录码无效或已过期")
        self._cookies.append(self._session_cookie(token, max_age=int(access.SESSION_TTL.total_seconds())))
        return {"ok": True}

    def _session_cookie(self, value: str, max_age: int) -> str:
        cookie = f"{access.COOKIE}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Strict"
        return cookie + "; Secure" if self._https() else cookie

    def _cookie(self) -> str | None:
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except Exception:  # noqa: BLE001 - 坏的 Cookie 头当作没登录
            return None
        morsel = jar.get(access.COOKIE)
        return morsel.value if morsel else None

    def _https(self) -> bool:
        if self.tls:
            return True
        return (self.config.server.trust_proxy
                and self.headers.get("X-Forwarded-Proto", "").split(",")[0].strip() == "https")

    def _client_ip(self) -> str:
        if self.config.server.trust_proxy and (forwarded := self.headers.get("X-Forwarded-For")):
            return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def _hostname(self) -> str:
        host = self.headers.get("Host", "")
        if host.startswith("["):
            return host[1:host.find("]")]
        return host.rsplit(":", 1)[0] if host.count(":") == 1 else host

    def _host_allowed(self) -> bool:
        """防 DNS rebinding：只认本机、本机网卡地址、配置里的中继域名。"""
        settings = self.config.server
        host = self._hostname().lower()
        if not host:
            return False
        if host in LOOPBACK or host in access.local_ips():
            return True
        patterns = list(settings.allowed_hosts)
        patterns += [urlparse(url).hostname or "" for url in settings.public_urls]
        return any(pattern == "*" or fnmatch.fnmatch(host, pattern.lower())
                   for pattern in patterns if pattern)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            body = json.loads(self.rfile.read(length))
        except json.JSONDecodeError as error:
            raise ValueError("请求体不是 JSON") from error
        if not isinstance(body, dict):
            raise ValueError("请求体要是 JSON 对象")
        return body

    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for cookie in getattr(self, "_cookies", []):
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(data)

    def _static(self, path: str) -> None:
        root = STATIC.resolve()
        # 挂在子路径下时 /deck/assets/x.js 也能找到；其余都回到 index.html。
        at = path.rfind("/assets/")
        relative = path[at + 1:] if at >= 0 else path.rsplit("/", 1)[-1]
        file = (root / relative).resolve()
        if not file.is_relative_to(root) or not file.is_file():
            file = root / "index.html"
        if not file.is_file():
            return self._text(HTTPStatus.NOT_FOUND,
                              "前端还没构建：cd web && pnpm install && pnpm build")
        data = file.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if file.name == "index.html":
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(data)

    def _text(self, status: int, text: str) -> None:
        data = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _project(row) -> dict:
    return {"key": row["key"], "name": row["name"], "repo": row["repo"]}


def _message(row, awaiting: bool) -> dict:
    return {
        "id": row["id"], "group_id": row["conversation"], "group_name": row["conversation_name"],
        "source": row["source"], "sender_name": row["sender_name"], "is_me": bool(row["is_me"]),
        "text": row["text"], "sent_at": row["sent_at"], "reply_to": row["reply_to"],
        "remote_id": row["remote_id"], "awaiting": awaiting,
    }


def _int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
