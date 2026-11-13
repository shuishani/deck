import subprocess
import sys
import threading
import time
from collections import deque
from collections.abc import Callable

from .adapters import adapter_for as default_adapter_for
from .config import Config, current
from .store import Store
from .sync import sync

# 钉钉有实时监听，轮询只是补漏。
DINGTALK_POLL_SECONDS = 300
_BACKOFF_START, _BACKOFF_MAX = 30, 600


class Watcher:
    """常驻：钉钉群各开一个 dws 实时监听，来消息就增量同步；channel 和监听断开的群按间隔轮询。"""

    def __init__(
        self,
        config: Config,
        sync_one: Callable[[int], None] | None = None,
        popen: Callable[..., subprocess.Popen] = subprocess.Popen,
    ):
        self.config = config
        self._sync_one = sync_one or self._default_sync
        self._popen = popen
        self._stop = threading.Event()
        # 停止或设置变化（如暂停平台）时叫醒主循环，不必等到下一轮轮询。
        self._wake = threading.Event()
        self._listeners: dict[int, _Listener] = {}
        self._locks: dict[int, threading.Lock] = {}
        self._guard = threading.Lock()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="deck-watch", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        for listener in list(self._listeners.values()):
            listener.stop()
        if self._thread:
            self._thread.join(timeout=15)

    def wake(self) -> None:
        self._wake.set()

    def run_forever(self) -> None:
        self.start()
        try:
            while self._thread and self._thread.is_alive():
                self._thread.join(timeout=1)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()

    def status(self, id: int) -> tuple[str, str | None]:
        """(模式, 监听的错误)：模式是 realtime 或 poll。"""
        listener = self._listeners.get(id)
        if listener and listener.connected:
            return "realtime", None
        return "poll", listener.error if listener else None

    def sync_conversation(self, id: int) -> None:
        with self._guard:
            lock = self._locks.setdefault(id, threading.Lock())
        with lock:
            self._sync_one(id)

    def _default_sync(self, id: int) -> None:
        store = Store(self.config.db_path, via="watcher")
        try:
            sync(store, lambda source: default_adapter_for(source, self.config), conversation=id)
        finally:
            store.close()

    def _loop(self) -> None:
        last_dingtalk_poll = float("-inf")
        while not self._stop.is_set():
            store = Store(self.config.db_path, via="watcher")
            try:
                try:
                    self.config = current(self.config, store.setting("runtime_config"))
                except (ValueError, TypeError, KeyError) as error:
                    # 设置损坏时沿用上一份配置继续监听，不让线程退出。
                    print(f"deck: 运行设置无效，沿用当前配置：{error}", file=sys.stderr)
                paused = store.paused_sources()
                rows = [row for row in store.conversations() if row["source"] not in paused]
            finally:
                store.close()
            self._reconcile(rows)
            now = time.monotonic()
            dingtalk_due = now - last_dingtalk_poll >= DINGTALK_POLL_SECONDS
            for row in rows:
                if self._stop.is_set():
                    break
                realtime = self.status(row["id"])[0] == "realtime"
                if row["source"] != "dingtalk" or dingtalk_due or not realtime:
                    self.sync_conversation(row["id"])
            if dingtalk_due:
                last_dingtalk_poll = now
            self._wake.wait(self.config.poll_seconds)
            self._wake.clear()

    def _reconcile(self, rows) -> None:
        wanted = {row["id"]: row for row in rows if row["source"] == "dingtalk"}
        for id in set(self._listeners) - set(wanted):
            self._listeners.pop(id).stop()
        for id, row in wanted.items():
            if id not in self._listeners:
                listener = _Listener(self, id, row["remote_id"])
                self._listeners[id] = listener
                listener.start()


class _Listener:
    def __init__(self, watcher: Watcher, id: int, chat_id: str):
        self._watcher = watcher
        self._id = id
        self._argv = [watcher.config.tools["dws"], "event", "+listen-im", "--kind", "group",
                      "--chat-id", chat_id, "--events", "message"]
        self._stop = threading.Event()
        self._proc: subprocess.Popen | None = None
        self.connected = False
        self.error: str | None = None

    def start(self) -> None:
        threading.Thread(target=self._run, name=f"deck-listen-{self._id}", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        proc = self._proc
        if proc and proc.poll() is None:
            # 让 dws 正常退出、取消订阅，不用 kill -9：先关 stdin（dws 视为退出信号），再发 SIGTERM。
            if getattr(proc, "stdin", None):
                try:
                    proc.stdin.close()
                except OSError:
                    pass
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()

    def _run(self) -> None:
        backoff = _BACKOFF_START
        while not self._stop.is_set():
            started = time.monotonic()
            self._listen_once()
            if self._stop.is_set():
                break
            if time.monotonic() - started > 120:
                backoff = _BACKOFF_START
            self._stop.wait(backoff)
            backoff = min(backoff * 2, _BACKOFF_MAX)

    def _listen_once(self) -> None:
        tail: deque[str] = deque(maxlen=5)
        try:
            proc = self._popen_dws()
        except OSError as error:
            self.error = f"启动 dws 失败：{error}"
            return
        self._proc = proc

        def read_stderr() -> None:
            for line in proc.stderr:
                line = line.strip()
                if not line:
                    continue
                tail.append(line)
                if "[event] ready" in line:
                    self.connected, self.error = True, None

        reader = threading.Thread(target=read_stderr, daemon=True)
        reader.start()
        for line in proc.stdout:
            if line.strip():
                self.connected = True
                self._watcher.sync_conversation(self._id)
        proc.wait()
        reader.join(timeout=2)
        self.connected = False
        if not self._stop.is_set():
            self.error = f"监听断开（退出码 {proc.returncode}）：{' / '.join(tail) or '无输出'}"

    def _popen_dws(self) -> subprocess.Popen:
        # stdin 一直开着：dws 读到 stdin 结束就会退出，后台运行（nohup、launchd）时 stdin 是空的。
        return self._watcher._popen(
            self._argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1,
        )
