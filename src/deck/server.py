import fnmatch
import json
import mimetypes
import re
import socket
import sqlite3
import ssl
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from . import access, ai, api, media
from . import config as config_module
from .api import ApiError
from .config import Config
from .health import SourceHealth
from .runner import ToolError
from .store import Store
from .watcher import Watcher

STATIC = Path(__file__).parent / "static"
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")
LOOPBACK = {"127.0.0.1", "localhost", "::1"}


def make_server(config: Config, watcher: Watcher | None) -> ThreadingHTTPServer:
    settings = config.server
    handler = type("Handler", (_Handler,), {
        "config": config, "watcher": watcher, "limiter": access.FailureLimiter(), "health": SourceHealth(),
        "tls": bool(settings.tls_cert and settings.tls_key),
    })
    _ensure_port_free(settings.host, settings.port)
    server = ThreadingHTTPServer((settings.host, settings.port), handler)
    server.daemon_threads = True
    if handler.tls:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(settings.tls_cert, settings.tls_key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


def _ensure_port_free(host: str, port: int) -> None:
    """macOS 上开了地址复用的套接字能叠在别人的 0.0.0.0 上绑定更具体的地址并抢走流量，绑定前先试连一下。
    不关地址复用：关掉后刚重启时会被 TIME_WAIT 连接挡住。"""
    if not port:
        return
    # 只试连本机回环：VPN / 代理的虚拟网卡（如 utun）会接受任何连接，试连网卡地址会误判为被占用。
    target = "127.0.0.1" if host in ("", "0.0.0.0", "::") else host
    try:
        with socket.create_connection((target, port), timeout=0.3):
            pass
    except OSError:
        return
    raise ValueError(f"端口 {port} 已被占用（{target}:{port} 上已有服务在监听），请先停止它或换端口")


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
                "error": f"未授权的访问地址 {host}；如为中继域名，请将其加入"
                         " ~/.deck/config.toml 的 [server] allowed_hosts"})
        url = urlparse(self.path)
        # 中继可能把看板挂在子路径下（/deck/api/...），按最后的 /api/ 切出接口路径。
        at = url.path.rfind("/api/")
        if at < 0:
            if self.command != "GET":
                return self._json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "不支持该请求方法"})
            return self._static(url.path)
        path = url.path[at:]
        # 改数据的请求要自定义头：别的网页没法跨站带上它。
        if self.command != "GET" and self.headers.get("X-Deck") != "1":
            return self._json(HTTPStatus.FORBIDDEN, {"error": "缺少 X-Deck 请求头"})
        found = api.resolve(self.command, path)
        store = Store(self.config.db_path, via="web")
        try:
            self.config = config_module.with_entry(
                config_module.current(self.config, store.setting("runtime_config")), store.setting("access_entry"))
            session = access.session_for(store, self._cookie(), self.client_ip())
            if not session and not (found and found[0].open):
                raise ApiError(HTTPStatus.UNAUTHORIZED, "需要登录", auth=True)
            if not found:
                raise ApiError(HTTPStatus.NOT_FOUND, "接口不存在")
            item, params = found
            query = {k: v[-1] for k, v in parse_qs(url.query).items()}
            body = {} if self.command == "GET" or item.raw_body else self._body()
            ctx = api.Context(store=store, config=self.config, watcher=self.watcher,
                              health=self.health, session=session, http=self, cookies=self._cookies)
            status, body = HTTPStatus.OK, item.handler(ctx, {**query, **body, **params})
        except ApiError as error:
            status, body = error.status, {"error": str(error), **error.extra}
        except LookupError as error:
            status, body = HTTPStatus.NOT_FOUND, {"error": str(error)}
        except ai.ModelError as error:
            status, body = HTTPStatus.BAD_GATEWAY, {"error": str(error)}
        except (ValueError, ToolError) as error:
            status, body = HTTPStatus.BAD_REQUEST, {"error": str(error)}
        except sqlite3.IntegrityError:
            status, body = HTTPStatus.CONFLICT, {"error": "记录已存在，不能重复添加"}
        finally:
            store.close()
        if isinstance(body, media.Media):
            return self._file(body)
        self._json(status, body)

    def read_upload(self, max_bytes: int) -> bytes:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ValueError("附件长度无效") from None
        if not 0 < length <= max_bytes:
            raise ValueError("附件为空或超过 10 MiB")
        previous_timeout = self.connection.gettimeout()
        try:
            self.connection.settimeout(30)
            data = self.rfile.read(length)
        except TimeoutError:
            raise ApiError(HTTPStatus.REQUEST_TIMEOUT, "附件上传超时，请重新选择文件后重试") from None
        finally:
            self.connection.settimeout(previous_timeout)
        if len(data) != length:
            raise ValueError("附件上传不完整，请重新上传")
        return data

    # --- 登录 ---

    @property
    def _cookie_name(self) -> str:
        # 浏览器的 Cookie 不分端口：同一台机器上另起的 deck（测试看板等）若同名，会顶掉正式看板的登录。
        port = self.config.server.port
        return access.COOKIE if port == 8765 else f"{access.COOKIE}_{port}"

    def session_cookie(self, value: str, max_age: int) -> str:
        cookie = f"{self._cookie_name}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Strict"
        return cookie + "; Secure" if self._https() else cookie

    def _cookie(self) -> str | None:
        # 不用 SimpleCookie：同主机其他服务的 Cookie 只要有一个不规范，它会把后面的全部丢掉，看起来像掉了登录。
        for part in self.headers.get("Cookie", "").split(";"):
            name, sep, value = part.strip().partition("=")
            if sep and name == self._cookie_name:
                return value.strip() or None
        return None

    def _https(self) -> bool:
        if self.tls:
            return True
        return (self.config.server.trust_proxy
                and self.headers.get("X-Forwarded-Proto", "").split(",")[0].strip() == "https")

    def origin(self) -> str:
        host = self.headers.get("X-Forwarded-Host") if self.config.server.trust_proxy else None
        host = (host or "").split(",")[0].strip() or self.headers.get("Host", "")
        return f"{'https' if self._https() else 'http'}://{host}"

    def is_local(self) -> bool:
        """本机直连：回环来源、回环 Host、没经过代理。中继和 tailscale serve 转发进来的请求
        也来自 127.0.0.1，但会带转发头或别的 Host，不算本机。"""
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            return False
        if self._hostname().lower() not in LOOPBACK:
            return False
        return not any(self.headers.get(name) for name in
                       ("X-Forwarded-For", "X-Forwarded-Host", "X-Real-IP", "Forwarded"))

    def client_ip(self) -> str:
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
            raise ValueError("请求体须为 JSON 对象")
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
                              "前端尚未构建，请运行：cd web && pnpm install && pnpm build")
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

    def _file(self, item: media.Media) -> None:
        size = item.path.stat().st_size
        start, end = 0, size - 1
        ranged = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", "").strip())
        if ranged and (ranged[1] or ranged[2]):
            # Safari 播放音视频必须支持按字节范围读取。
            if ranged[1]:
                start, end = int(ranged[1]), min(int(ranged[2] or end), end)
            else:
                start = max(size - int(ranged[2]), 0)
            if start > end:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
        with item.path.open("rb") as file:
            file.seek(start)
            data = file.read(end - start + 1)
        self.send_response(HTTPStatus.PARTIAL_CONTENT if ranged and (ranged[1] or ranged[2])
                           else HTTPStatus.OK)
        self.send_header("Content-Type", item.mime if item.inline else "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        if ranged and (ranged[1] or ranged[2]):
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Accept-Ranges", "bytes")
        disposition = "inline" if item.inline else "attachment"
        self.send_header("Content-Disposition", f"{disposition}; filename*=UTF-8''{quote(item.name)}")
        self.send_header("Cache-Control", "private, max-age=86400")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
        self.end_headers()
        self.wfile.write(data)

    def _text(self, status: int, text: str) -> None:
        data = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
