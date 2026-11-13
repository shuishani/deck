import hashlib
import ipaddress
import json
import re
import secrets
import shlex
import shutil
import socket
import subprocess
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from .store import Store

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 10
CODE_TTL = timedelta(minutes=10)
SESSION_TTL = timedelta(days=30)
COOKIE = "deck_session"
_TOUCH_EVERY = timedelta(minutes=5)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds")


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def normalize_code(code: str) -> str:
    return re.sub(r"[\s-]", "", code).upper()


def create_pairing(store: Store, issued_to: str = "cli") -> tuple[str, datetime]:
    """一次性登录码：10 分钟内有效，用一次就作废。库里只存哈希；issued_to 记在操作日志里。"""
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
    expires = _now() + CODE_TTL
    with store.db:
        store.db.execute("DELETE FROM pairings WHERE expires_at < ?", (_iso(_now()),))
        store.db.execute(
            "INSERT INTO pairings (code_hash, created_at, expires_at) VALUES (?, ?, ?)",
            (_hash(code), _iso(_now()), _iso(expires)),
        )
    store.audit("me", "access.pairing", issued_to, {}, "ok")
    return code, expires


def redeem(store: Store, code: str, user_agent: str, ip: str, origin: str = "") -> str | None:
    """用登录码换一个会话；码无效、过期或用过返回 None。origin 是登录时打开的地址。"""
    now = _iso(_now())
    with store.db:
        used = store.db.execute(
            "UPDATE pairings SET used_at = ? WHERE code_hash = ? AND used_at IS NULL"
            " AND expires_at > ?",
            (now, _hash(normalize_code(code)), now),
        ).rowcount
        if not used:
            return None
        token = _insert_session(store, user_agent, ip, origin)
    store.audit("me", "access.login", ip, {"user_agent": user_agent[:300]}, "ok")
    return token


_PASSWORD_KEY = "local_password"
PASSWORD_MIN = 6


def _scrypt(password: str, salt: bytes) -> str:
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1).hex()


def set_local_password(store: Store, password: str | None) -> None:
    """本机密码：只用于本机直连登录。库里只存加盐的 scrypt 哈希；None 表示清除。"""
    with store.db:
        if password is None:
            store.db.execute("DELETE FROM settings WHERE key = ?", (_PASSWORD_KEY,))
        else:
            if len(password) < PASSWORD_MIN:
                raise ValueError(f"密码至少 {PASSWORD_MIN} 位")
            salt = secrets.token_bytes(16)
            store.db.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (_PASSWORD_KEY, f"scrypt${salt.hex()}${_scrypt(password, salt)}"),
            )
    store.audit("me", "access.password", "local", {}, "cleared" if password is None else "set")


def has_local_password(store: Store) -> bool:
    return store.db.execute(
        "SELECT 1 FROM settings WHERE key = ?", (_PASSWORD_KEY,)).fetchone() is not None


def password_login(store: Store, password: str, user_agent: str, ip: str,
                   origin: str) -> str | None:
    """用本机密码换一个会话；没设密码或密码不对返回 None。调用方负责确认请求来自本机。"""
    row = store.db.execute(
        "SELECT value FROM settings WHERE key = ?", (_PASSWORD_KEY,)).fetchone()
    if not row:
        return None
    _, salt, digest = row["value"].split("$")
    if not secrets.compare_digest(_scrypt(password, bytes.fromhex(salt)), digest):
        return None
    with store.db:
        token = _insert_session(store, user_agent, ip, origin)
    store.audit("me", "access.password_login", ip, {"user_agent": user_agent[:300]}, "ok")
    return token


def _insert_session(store: Store, user_agent: str, ip: str, origin: str) -> str:
    now = _iso(_now())
    token = secrets.token_urlsafe(32)
    store.db.execute(
        "INSERT INTO sessions (token_hash, created_at, last_seen_at, expires_at,"
        " user_agent, ip, origin) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (_hash(token), now, now, _iso(_now() + SESSION_TTL), user_agent[:300], ip, origin[:300]),
    )
    return token


def session_for(store: Store, token: str | None, ip: str | None = None):
    """有效会话的那一行；顺便续期（最多每 5 分钟写一次库）。"""
    if not token:
        return None
    row = store.db.execute(
        "SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ? AND disabled_at IS NULL",
        (_hash(token), _iso(_now())),
    ).fetchone()
    if row and _now() - datetime.fromisoformat(row["last_seen_at"]) > _TOUCH_EVERY:
        with store.db:
            store.db.execute(
                "UPDATE sessions SET last_seen_at = ?, expires_at = ?, ip = COALESCE(?, ip)"
                " WHERE id = ?",
                (_iso(_now()), _iso(_now() + SESSION_TTL), ip, row["id"]),
            )
    return row


def sessions(store: Store) -> list:
    return store.db.execute(
        "SELECT id, created_at, last_seen_at, user_agent, ip, origin, disabled_at FROM sessions"
        " WHERE expires_at > ? ORDER BY last_seen_at DESC",
        (_iso(_now()),),
    ).fetchall()


def set_disabled(store: Store, id: int, disabled: bool) -> bool:
    """禁用：这台设备暂时打不开 deck，但不用重新配对，启用后照常。"""
    with store.db:
        changed = store.db.execute(
            "UPDATE sessions SET disabled_at = ? WHERE id = ?",
            (_iso(_now()) if disabled else None, id),
        ).rowcount
    if changed:
        store.audit("me", "access.disable" if disabled else "access.enable", str(id), {}, "ok")
    return bool(changed)


def revoke(store: Store, id: int | None = None) -> int:
    """移除一个会话；id 为 None 时移除全部。"""
    with store.db:
        if id is None:
            removed = store.db.execute("DELETE FROM sessions").rowcount
        else:
            removed = store.db.execute("DELETE FROM sessions WHERE id = ?", (id,)).rowcount
    if removed:
        store.audit("me", "access.revoke", "all" if id is None else str(id), {}, f"removed {removed}")
    return removed


class FailureLimiter:
    """同一来源 10 分钟内登录失败 10 次就先拒绝。"""

    def __init__(self, limit: int = 10, window: float = 600):
        self.limit, self.window = limit, window
        self._failures: dict[str, list[float]] = {}

    def blocked(self, key: str) -> bool:
        recent = [t for t in self._failures.get(key, []) if time.monotonic() - t < self.window]
        self._failures[key] = recent
        return len(recent) >= self.limit

    def fail(self, key: str) -> None:
        self._failures.setdefault(key, []).append(time.monotonic())


_ips_cache: tuple[float, list[tuple[str, str]]] = (0.0, [])
_TAILSCALE = ipaddress.ip_network("100.64.0.0/10")


def local_ips() -> list[str]:
    return [ip for ip, _ in local_interfaces()]


def local_interfaces() -> list[tuple[str, str]]:
    """本机的局域网 / VPN IPv4 地址和网卡名（如 ("10.0.0.5", "en0")），尽力而为，缓存 60 秒。"""
    global _ips_cache
    if time.monotonic() - _ips_cache[0] < 60:
        return _ips_cache[1]
    found: list[tuple[str, str]] = []
    try:
        output = subprocess.run(["ifconfig"], capture_output=True, text=True, timeout=3).stdout
        iface = ""
        for line in output.splitlines():
            if line and not line[0].isspace():
                iface = line.split(":", 1)[0]
            elif match := re.search(r"inet (?:addr:)?(\d+\.\d+\.\d+\.\d+)", line):
                found.append((match[1], iface))
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))  # 不发包，只为让系统选出默认出口地址
            found.append((probe.getsockname()[0], ""))
    except OSError:
        pass
    result: list[tuple[str, str]] = []
    for ip, iface in found:
        address = ipaddress.ip_address(ip)
        if address.is_loopback or address.is_link_local or any(ip == seen for seen, _ in result):
            continue
        result.append((ip, iface))
    _ips_cache = (time.monotonic(), result)
    return result


def describe(ip: str, iface: str) -> tuple[str, str, bool]:
    """(种类, 名称, 链路是否加密)。Tailscale 走 WireGuard，自带加密。"""
    if ipaddress.ip_address(ip) in _TAILSCALE:
        return "tailscale", "Tailscale", True
    if iface.startswith(("en", "eth", "wl")):
        return "lan", "局域网（Wi-Fi / 有线）", False
    return "other", f"其他网络 · {iface}" if iface else "其他网络", False


_tailscale_cache: tuple[float, dict | None] = (0.0, None)
_MOBILE_OS = {"android", "ios"}


def tailscale_status() -> dict | None:
    """Tailscale 是否在跑、tailnet 里哪些手机在线、本机已生效 / 已宣告的路由；
    没装或读不到返回 None。缓存 5 秒。"""
    global _tailscale_cache
    if time.monotonic() - _tailscale_cache[0] < 5:
        return _tailscale_cache[1]
    cli = shutil.which("tailscale") or "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    result = None
    try:
        output = subprocess.run([cli, "status", "--json"], capture_output=True, text=True,
                                timeout=3).stdout
        data = json.loads(output)
        phones = [p for p in (data.get("Peer") or {}).values()
                  if str(p.get("OS", "")).lower() in _MOBILE_OS]
        me = data.get("Self") or {}
        result = {
            "running": data.get("BackendState") == "Running",
            "phones": [p.get("HostName", "") for p in phones],
            "phones_online": [p.get("HostName", "") for p in phones if p.get("Online")],
            "routes": list(me.get("PrimaryRoutes") or []) + list(me.get("AllowedIPs") or []),
            "advertised": [], "routes_known": False,
        }
        proc = subprocess.run([cli, "debug", "prefs"], capture_output=True, text=True, timeout=3)
        prefs = json.loads(proc.stdout)
        if proc.returncode != 0 or not isinstance(prefs, dict) or "AdvertiseRoutes" not in prefs:
            raise ValueError("无法确认已有路由")
        routes = [] if prefs["AdvertiseRoutes"] is None else prefs["AdvertiseRoutes"]
        if not isinstance(routes, list) or any(not isinstance(r, str) for r in routes):
            raise ValueError("已有路由格式未知")
        for route in routes:
            ipaddress.ip_network(route, strict=False)
        result["advertised"] = routes
        result["routes_known"] = True
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    _tailscale_cache = (time.monotonic(), result)
    return result


def entry_plan(config, url: str) -> dict:
    """只生成方案，不发布路由；宣告单个地址仍受 tailnet ACL 和管理员批准限制。"""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("入口须为不含账号密码的 HTTP 或 HTTPS 地址")
    if parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ValueError("局域网统一入口不能包含子路径、查询参数或登录码")
    try:
        ip = ipaddress.IPv4Address(parsed.hostname)
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as error:
        raise ValueError("局域网统一入口须使用本机局域网 IPv4 地址") from error
    lan = {address for address, iface in local_interfaces() if describe(address, iface)[0] == "lan"}
    if str(ip) not in lan or port != config.server.port:
        raise ValueError("入口须指向本机当前局域网地址和 deck 监听端口")
    if config.server.host not in ("0.0.0.0", str(ip)):
        raise ValueError("deck 当前未监听这个局域网地址，请先配置 server.host")
    tls = bool(config.server.tls_cert and config.server.tls_key)
    if (parsed.scheme == "https") != tls:
        raise ValueError("入口协议与 deck 当前 TLS 配置不一致")
    status = tailscale_status()
    known = bool(status is not None and status.get("routes_known", "advertised" in status))
    previous = list(status.get("advertised") or []) if known else None
    route = f"{ip}/32"
    covered = any(ip in ipaddress.ip_network(r, strict=False) for r in previous or [])
    routes = (previous if covered else [*previous, route]) if previous is not None else None
    cli = shutil.which("tailscale") or "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    argv = [cli, "set", f"--advertise-routes={','.join(routes)}"] if known else None
    rollback = [cli, "set", f"--advertise-routes={','.join(previous)}"] if known else None
    return {"url": f"{parsed.scheme}://{ip}:{port}/", "route": route,
            "remote": route_state(str(ip), status), "running": bool((status or {}).get("running")),
            "routes_known": known, "previous_routes": previous, "advertise_routes": routes,
            "command": shlex.join(argv) if argv else None, "rollback_command": shlex.join(rollback) if rollback else None,
            "warnings": ([] if known else ["现有路由未知，禁止生成或执行覆盖命令；请先恢复本机 Tailscale 状态查询。"]) + ["这是单主机路由，不是端口白名单；tailnet 访问规则应仅允许所需端口。",
                         "宣告后仍需管理员批准，不能把待批准显示成可远程访问。",
                         "电脑局域网地址需保留固定 IP；地址变化时会告警，不自动更换统一入口。",
                         "HTTP 在局域网中不加密；Tailscale 路径本身加密。"]}


def pin_entry(store: Store, config, url: str) -> dict:
    plan = entry_plan(config, url)
    store.set_setting("access_entry", {"url": plan["url"]})
    store.audit("me", "access.entry", plan["url"], {"route": plan["route"]}, "ok")
    return plan


def route_state(ip: str, status: dict | None) -> str:
    """外网能否经 Tailscale 到达这个局域网地址：active 已生效、pending 已宣告待批准、none 未配置。"""
    if not status or not status.get("running"):
        return "none"
    address = ipaddress.ip_address(ip)

    def covers(prefixes: list[str]) -> bool:
        for prefix in prefixes:
            try:
                if address in ipaddress.ip_network(prefix, strict=False):
                    return True
            except ValueError:
                continue
        return False

    if covers(status.get("routes") or []):
        return "active"
    return "pending" if covers(status.get("advertised") or []) else "none"


def addresses(config) -> list[dict]:
    """固定入口不随网卡、手机状态改变；未固定时只展示候选，不冒充已连通。"""
    settings = config.server
    tls = bool(settings.tls_cert and settings.tls_key)
    scheme = "https" if tls else "http"
    order = {"relay": 0, "lan": 1, "tailscale": 2, "other": 3, "local": 4}
    result = [{"kind": "relay", "label": "中继", "url": url if url.endswith("/") else url + "/",
               "secure": url.startswith("https://"), "status": "任意网络均可访问",
               "usable": True} for url in settings.public_urls]
    if settings.host not in ("127.0.0.1", "localhost", "::1"):
        tailscale = tailscale_status()
        for ip, iface in local_interfaces():
            kind, label, encrypted = describe(ip, iface)
            entry = {"kind": kind, "label": label, "url": f"{scheme}://{ip}:{settings.port}/",
                     "secure": tls or encrypted, "usable": True, "status": ""}
            if kind == "tailscale":
                online = (tailscale or {}).get("phones_online") or []
                entry["usable"] = bool(online)
                entry["status"] = (f"{'、'.join(online)} 在线" if online
                                   else "手机端 Tailscale 未连接")
            elif kind == "lan":
                state = route_state(ip, tailscale)
                entry["remote"] = state
                entry["route"] = f"{ip}/32"
                entry["status"] = {"active": "同一 Wi-Fi 直连，外网经 Tailscale 访问",
                                   "pending": "外网访问待批准",
                                   "none": "仅同一 Wi-Fi 可用"}[state]
            else:
                entry["status"] = "其他网卡（例如公司 VPN）"
            result.append(entry)
    result.append({"kind": "local", "label": "本机", "url": f"{scheme}://127.0.0.1:{settings.port}/",
                   "secure": True, "usable": True, "status": "仅限本机"})
    result.sort(key=lambda a: order[a["kind"]])
    pinned = settings.entry_url
    primary = next((a for a in result if a["url"] == pinned), None) if pinned else result[0]
    if pinned and primary is None:
        # 电脑换网后不偷偷选另一个 IP，否则会更换 origin 并丢失该地址下的登录态。
        primary = {"kind": "lan", "label": "统一入口", "url": pinned,
                   "secure": pinned.startswith("https://"), "usable": False,
                   "remote": "none", "status": "电脑网络地址已变化，固定入口当前不可用；请检查 IP 保留设置"}
        result.insert(0, primary)
    for entry in result:
        entry["recommended"] = entry is primary
        entry["pinned"] = bool(pinned and entry is primary)
    return result
