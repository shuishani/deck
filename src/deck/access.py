import hashlib
import ipaddress
import json
import re
import secrets
import shutil
import socket
import subprocess
import time
from datetime import datetime, timedelta, timezone

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


def create_pairing(store: Store) -> tuple[str, datetime]:
    """一次性登录码：10 分钟内有效，用一次就作废。库里只存哈希。"""
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
    expires = _now() + CODE_TTL
    with store.db:
        store.db.execute("DELETE FROM pairings WHERE expires_at < ?", (_iso(_now()),))
        store.db.execute(
            "INSERT INTO pairings (code_hash, created_at, expires_at) VALUES (?, ?, ?)",
            (_hash(code), _iso(_now()), _iso(expires)),
        )
    return code, expires


def redeem(store: Store, code: str, user_agent: str, ip: str) -> str | None:
    """用登录码换一个会话；码无效、过期或用过返回 None。"""
    now = _iso(_now())
    with store.db:
        used = store.db.execute(
            "UPDATE pairings SET used_at = ? WHERE code_hash = ? AND used_at IS NULL"
            " AND expires_at > ?",
            (now, _hash(normalize_code(code)), now),
        ).rowcount
        if not used:
            return None
        token = secrets.token_urlsafe(32)
        store.db.execute(
            "INSERT INTO sessions (token_hash, created_at, last_seen_at, expires_at,"
            " user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)",
            (_hash(token), now, now, _iso(_now() + SESSION_TTL), user_agent[:300], ip),
        )
    store.audit("me", "access.login", ip, {"user_agent": user_agent[:300]}, "ok")
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
        "SELECT id, created_at, last_seen_at, user_agent, ip, disabled_at FROM sessions"
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
    """Tailscale 是否在跑、tailnet 里哪些手机在线；没装或读不到返回 None。缓存 5 秒。"""
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
        result = {
            "running": data.get("BackendState") == "Running",
            "phones": [p.get("HostName", "") for p in phones],
            "phones_online": [p.get("HostName", "") for p in phones if p.get("Online")],
        }
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    _tailscale_cache = (time.monotonic(), result)
    return result
