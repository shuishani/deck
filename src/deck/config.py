import json
import math
import os
import shutil
import sqlite3
import tomllib
from contextlib import closing
from dataclasses import dataclass, field, replace
from pathlib import Path

TEMPLATE = """\
# deck 配置
# 消息在本地保存多少天，deck prune 时删除更早的
retention_days = {retention_days}
# AI 对外发消息时加在开头的身份说明（deck send --ai）
ai_prefix = "{ai_prefix}"
# @我的消息超过多少小时没回，算超时
reply_reminder_hours = 2
# 这些发送人（如通知机器人）@我 不算要我回复
ignore_senders = []
# channel 多少秒轮询一次；钉钉有实时监听，另按 5 分钟补拉一次
poll_seconds = 30

[tools]
dws = "{dws}"
drlee = "{drlee}"
# 可选：channel 发消息改用这个 drlee（新版 CLI 发出的消息会被标成「拍档 / AI 代发」）
# drlee_send = "/path/to/drlee-legacy"
""" + """
[server]
# 只在本机用就保持 127.0.0.1；要让局域网的手机、电脑访问改成 "0.0.0.0"
host = "127.0.0.1"
port = 8765
# 通过中继访问时的地址，如 "https://deck.example.com/"，会出现在「添加设备」里
public_urls = []
# 固定统一入口；设置后不随网卡顺序、手机在线状态自动变化
entry_url = ""
# 除本机和局域网 IP 外允许的主机名（中继域名），支持 * 通配；["*"] 表示不检查
allowed_hosts = []
# 前面有反向代理 / 中继时打开，才会信任它传来的 X-Forwarded-For / X-Forwarded-Proto
trust_proxy = false
# 直接用 HTTPS：证书和私钥路径
tls_cert = ""
tls_key = ""
"""


@dataclass(frozen=True)
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8765
    public_urls: tuple[str, ...] = ()
    entry_url: str = ""
    allowed_hosts: tuple[str, ...] = ()
    trust_proxy: bool = False
    tls_cert: str = ""
    tls_key: str = ""


@dataclass(frozen=True)
class Config:
    home: Path
    retention_days: int = 30
    ai_prefix: str = ""
    reply_reminder_hours: float = 2
    ignore_senders: tuple[str, ...] = ()
    poll_seconds: int = 30
    tools: dict[str, str] = field(default_factory=lambda: {"dws": "dws", "drlee": "drlee"})
    server: ServerConfig = field(default_factory=ServerConfig)

    @property
    def db_path(self) -> Path:
        return self.home / "deck.db"


def home() -> Path:
    return Path(os.environ.get("DECK_HOME") or Path.home() / ".deck")


def config_path(base: Path) -> Path:
    return base / "config.toml"


def load(base: Path | None = None) -> Config:
    base = base or home()
    path = config_path(base)
    if not path.exists():
        raise FileNotFoundError(f"尚未初始化：{path} 不存在，请先运行 deck init")
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    config = Config(
        home=base,
        **_editable(data),
        tools={"dws": "dws", "drlee": "drlee", **data.get("tools", {})},
        server=_server(data.get("server", {})),
    )
    if config.db_path.exists():
        # sqlite3 连接的 with 只管事务不关连接，用 closing 关掉。
        with closing(sqlite3.connect(f"{config.db_path.as_uri()}?mode=ro", uri=True)) as db:
            if db.execute("SELECT 1 FROM sqlite_master WHERE name = 'settings'").fetchone():
                row = db.execute("SELECT value FROM settings WHERE key = 'runtime_config'").fetchone()
                if row:
                    config = replace(config, **validate_settings(json.loads(row[0])))
                entry = db.execute("SELECT value FROM settings WHERE key = 'access_entry'").fetchone()
                if entry:
                    config = with_entry(config, json.loads(entry[0]))
    return config


EDITABLE = ("retention_days", "ai_prefix", "reply_reminder_hours", "ignore_senders", "poll_seconds")


def _editable(data: dict) -> dict:
    return {"retention_days": int(data.get("retention_days", 30)),
            "ai_prefix": str(data.get("ai_prefix", "")),
            "reply_reminder_hours": float(data.get("reply_reminder_hours", 2)),
            "ignore_senders": tuple(data.get("ignore_senders", ())),
            "poll_seconds": max(5, int(data.get("poll_seconds", 30)))}


def file_defaults(base: Path) -> dict:
    """config.toml 里的值（网页、CLI 改过的覆盖值之外的默认值）。"""
    path = config_path(base)
    return _editable(tomllib.loads(path.read_text(encoding="utf-8"))) if path.exists() else {}


def current(config: Config, overrides: dict) -> Config:
    """默认值 + 覆盖值。不能在已带覆盖值的 config 上叠加，否则去掉覆盖值后回不到默认值。"""
    return replace(config, **validate_settings({**file_defaults(config.home), **overrides}))


def validate_settings(data: dict) -> dict:
    if set(data) - set(EDITABLE):
        raise ValueError("只允许修改消息与提醒设置，不允许修改服务地址或凭据")
    values = dict(data)
    for key, minimum, maximum in (("retention_days", 1, 3650), ("poll_seconds", 5, 3600)):
        if key in values and (type(values[key]) is not int or not minimum <= values[key] <= maximum):
            raise ValueError(f"{key} 须为 {minimum}～{maximum} 的整数")
    if "reply_reminder_hours" in values:
        n = values["reply_reminder_hours"]
        if type(n) not in (int, float) or not math.isfinite(n) or not 0 < n <= 8760:
            raise ValueError("提醒时限须大于 0 且不超过 8760 小时")
    if "ai_prefix" in values and (not isinstance(values["ai_prefix"], str) or len(values["ai_prefix"]) > 200):
        raise ValueError("身份前缀须为不超过 200 字的文本")
    if "ignore_senders" in values:
        names = values["ignore_senders"]
        if not isinstance(names, (list, tuple)) or len(names) > 100 or any(
            not isinstance(n, str) or not n.strip() or len(n) > 200 for n in names
        ):
            raise ValueError("忽略发送人须为姓名列表，每项不能为空")
        values["ignore_senders"] = tuple(dict.fromkeys(n.strip() for n in names))
    return values


def with_entry(config: Config, entry: dict) -> Config:
    return replace(config, server=replace(config.server, entry_url=entry["url"])) if entry else config


def _server(data: dict) -> ServerConfig:
    return ServerConfig(
        host=str(data.get("host", "127.0.0.1")),
        port=int(data.get("port", 8765)),
        public_urls=tuple(str(url) for url in data.get("public_urls", ())),
        entry_url=str(data.get("entry_url", "")),
        allowed_hosts=tuple(str(host) for host in data.get("allowed_hosts", ())),
        trust_proxy=bool(data.get("trust_proxy", False)),
        tls_cert=str(data.get("tls_cert", "")),
        tls_key=str(data.get("tls_key", "")),
    )


def init(base: Path, dws: str | None, drlee: str | None) -> Path:
    base.mkdir(parents=True, exist_ok=True)
    base.chmod(0o700)
    path = config_path(base)
    if path.exists():
        return path
    path.write_text(
        TEMPLATE.format(
            retention_days=30,
            ai_prefix="【MX 助手】",
            dws=dws or shutil.which("dws") or "dws",
            drlee=drlee or shutil.which("drlee") or "drlee",
        ),
        encoding="utf-8",
    )
    path.chmod(0o600)
    return path
