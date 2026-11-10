import os
import shutil
import tomllib
from dataclasses import dataclass, field
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
""" + """
[server]
# 只在本机用就保持 127.0.0.1；要让局域网的手机、电脑访问改成 "0.0.0.0"
host = "127.0.0.1"
port = 8765
# 通过中继访问时的地址，如 "https://deck.example.com/"，会出现在「添加设备」里
public_urls = []
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
        raise FileNotFoundError(f"还没初始化：{path} 不存在，先运行 deck init")
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    return Config(
        home=base,
        retention_days=int(data.get("retention_days", 30)),
        ai_prefix=str(data.get("ai_prefix", "")),
        reply_reminder_hours=float(data.get("reply_reminder_hours", 2)),
        ignore_senders=tuple(data.get("ignore_senders", ())),
        poll_seconds=max(5, int(data.get("poll_seconds", 30))),
        tools={"dws": "dws", "drlee": "drlee", **data.get("tools", {})},
        server=_server(data.get("server", {})),
    )


def _server(data: dict) -> ServerConfig:
    return ServerConfig(
        host=str(data.get("host", "127.0.0.1")),
        port=int(data.get("port", 8765)),
        public_urls=tuple(str(url) for url in data.get("public_urls", ())),
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
