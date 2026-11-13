"""只查询 CLI 的本地账号摘要，不读取或返回凭据，不触发远程登录验证。"""

import json
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone

from .config import Config


class SourceHealth:
    def __init__(self):
        self._cache: dict[tuple[str, str], tuple[float, dict]] = {}
        # 每个平台各一把锁：同一平台的并发请求共用一次探测，不同平台互不等待。
        self._locks: dict[tuple[str, str], threading.Lock] = {}
        self._guard = threading.Lock()

    def get(self, source: str, config: Config) -> dict:
        tool = config.tools["dws" if source == "dingtalk" else "drlee"]
        key = (source, tool)
        with self._guard:
            lock = self._locks.setdefault(key, threading.Lock())
        with lock:
            cached = self._cache.get(key)
            if cached and time.monotonic() - cached[0] < 60:
                return cached[1]
            result = self._probe(source, tool)
            self._cache[key] = (time.monotonic(), result)
            return result

    def _probe(self, source: str, tool: str) -> dict:
        result = {"available": False, "version": None, "account": None,
                  "expires_at": None, "auth_state": "unknown", "error": None,
                  "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        binary = shutil.which(tool)
        if not binary:
            return {**result, "error": "找不到 CLI，请检查工具路径"}
        result["available"] = True
        try:
            version = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=5)
            if version.returncode == 0:
                result["version"] = version.stdout.strip()[:100] or None
            else:
                result["error"] = "无法查询 CLI 版本"
            argv = ([binary, "auth", "status", "-f", "json"] if source == "dingtalk"
                    else [binary, "--json", "auth", "list"])
            proc = subprocess.run(argv, capture_output=True, text=True, timeout=5)
            if proc.returncode != 0:
                return {**result, "error": "无法查询本地登录状态，请在本机检查 CLI"}
            data = json.loads(proc.stdout)
            if source == "dingtalk":
                if not isinstance(data, dict):
                    raise ValueError("账号摘要格式未知")
                user = data.get("user_id")
                result.update(account=data.get("user_name") or user,
                              auth_state="configured" if user else "missing")
            else:
                rows = data.get("data") if isinstance(data, dict) else data
                if isinstance(rows, dict):
                    rows = rows.get("items")
                if not isinstance(rows, list):
                    raise ValueError("账号摘要格式未知")
                current = next((r for r in rows if isinstance(r, dict) and r.get("current")), None)
                if not current:
                    result["auth_state"] = "missing"
                else:
                    state = current.get("credential_state")
                    result.update(account=current.get("email") or current.get("user_id"),
                                  auth_state={"reauthentication_required": "needs_login", "valid": "configured"}.get(state, "unknown"))
                    expires = current.get("access_expires_at")
                    if type(expires) in (int, float):
                        result["expires_at"] = datetime.fromtimestamp(expires, timezone.utc).isoformat(timespec="seconds")
        except (OSError, subprocess.TimeoutExpired, ValueError, OverflowError):
            # 上游输出可能带凭据；不把原始 stdout/stderr 或异常文本传给看板。
            result["error"] = "本地状态查询失败，授权状态未知"
            result["auth_state"] = "unknown"
        return result

