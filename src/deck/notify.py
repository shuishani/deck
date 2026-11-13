"""钉钉推送：设置、机器人 Webhook（存在钥匙串里）和签名发送。什么时候推由后台按这里的规则决定。"""
import base64
import hashlib
import hmac
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

from . import keychain
from .store import Store

WEBHOOK_ITEM = "deck-notify-webhook"
SECRET_ITEM = "deck-notify-secret"
_WEBHOOK = re.compile(r"https://oapi\.dingtalk\.com/robot/send\?access_token=[A-Za-z0-9]+")
LEVELS = ("urgent", "high", "medium", "low")
# 每一级：上班时间、下班后，消息多少分钟没读也没回就推送；None 表示不推送。
DEFAULTS = {
    "enabled": True,
    "levels": {"urgent": {"work": 15, "off": 30}, "high": {"work": None, "off": None},
               "medium": {"work": None, "off": None}, "low": {"work": None, "off": None}},
    "work_days": [1, 2, 3, 4, 5], "work_start": "09:30", "work_end": "18:30",
    "digest": True, "digest_time": "09:30",
}
_CLOCK = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")


def _stored(store: Store) -> dict:
    stored = store.setting("notify")
    values = {k: stored.get(k, v) for k, v in DEFAULTS.items()}
    values["levels"] = {k: {**DEFAULTS["levels"][k], **values["levels"].get(k, {})} for k in LEVELS}
    return values


def settings(store: Store) -> dict:
    """推送设置，加上钥匙串里有没有机器人地址和加签密钥（不返回它们本身）。"""
    return {**_stored(store), "webhook": bool(keychain.read(WEBHOOK_ITEM)), "signed": bool(keychain.read(SECRET_ITEM))}


def wait(store: Store, level: str, now: datetime) -> int | None:
    """这一级此刻（按上班时间 / 下班后）没处理多少分钟就推送；None 表示不推送。"""
    values = _stored(store)
    local = now.astimezone()
    work = (local.isoweekday() in values["work_days"]
            and values["work_start"] <= local.strftime("%H:%M") < values["work_end"])
    return values["levels"][level]["work" if work else "off"]


def configure(store: Store, data: dict) -> dict:
    if set(data) - set(DEFAULTS):
        raise ValueError("未知的推送设置")
    values = _stored(store)
    if "levels" in data:
        if not isinstance(data["levels"], dict) or set(data["levels"]) - set(LEVELS):
            raise ValueError("级别须为 urgent / high / medium / low")
        for level, rule in data["levels"].items():
            if not isinstance(rule, dict) or set(rule) - {"work", "off"}:
                raise ValueError("每一级只能设置 work 和 off")
            for value in rule.values():
                if value is not None and (type(value) is not int or not 0 <= value <= 1440):
                    raise ValueError("推送等待时间须为 0～1440 分钟，不推送填 null")
            values["levels"][level] = {**values["levels"][level], **rule}
    for key in ("enabled", "digest"):
        if key in data:
            if type(data[key]) is not bool:
                raise ValueError(f"{key} 须为布尔值")
            values[key] = data[key]
    for key in ("work_start", "work_end", "digest_time"):
        if key in data:
            if not isinstance(data[key], str) or not _CLOCK.fullmatch(data[key]):
                raise ValueError("时间须为 HH:MM")
            values[key] = data[key]
    if "work_days" in data:
        days = data["work_days"]
        if not isinstance(days, list) or any(type(d) is not int or not 1 <= d <= 7 for d in days):
            raise ValueError("工作日须为 1～7（周一到周日）的列表")
        values["work_days"] = sorted(set(days))
    if values["work_start"] >= values["work_end"]:
        raise ValueError("下班时间须晚于上班时间")
    store.set_setting("notify", values)
    store.audit("me", "notify.settings", "notify", {"fields": sorted(data)}, "ok")
    return settings(store)


def set_webhook(store: Store, url: str, secret: str) -> dict:
    url, secret = url.strip(), secret.strip()
    if not _WEBHOOK.fullmatch(url):
        raise ValueError("Webhook 须为钉钉自定义机器人地址：https://oapi.dingtalk.com/robot/send?access_token=…")
    if secret and not re.fullmatch(r"SEC[0-9a-f]{20,}", secret):
        raise ValueError("加签密钥须以 SEC 开头")
    keychain.write(WEBHOOK_ITEM, url)
    if secret:
        keychain.write(SECRET_ITEM, secret)
    store.audit("me", "notify.webhook", "notify", {"signed": bool(secret)}, "ok")
    return settings(store)


def send(title: str, text: str) -> None:
    """用机器人发一条 Markdown 消息；失败抛 ValueError，不重试。"""
    url = keychain.read(WEBHOOK_ITEM)
    if not url:
        raise ValueError("还没有配置钉钉机器人 Webhook")
    secret = keychain.read(SECRET_ITEM)
    if secret:
        stamp = str(round(time.time() * 1000))
        digest = hmac.new(secret.encode(), f"{stamp}\n{secret}".encode(), hashlib.sha256).digest()
        url += f"&timestamp={stamp}&sign={urllib.parse.quote_plus(base64.b64encode(digest))}"
    body = {"msgtype": "markdown", "markdown": {"title": title, "text": text}}
    request = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode(),
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        raise ValueError("连接钉钉失败，请检查网络") from None
    if result.get("errcode") != 0:
        raise ValueError(f"钉钉拒绝了这条消息：{result.get('errmsg', '未知原因')}")


def test(store: Store) -> None:
    try:
        send("deck 测试", "#### deck管家\n通知渠道测试：收到这条，说明提醒和日报能发到这里。")
    except ValueError as error:
        store.audit("me", "notify.test", "notify", {}, f"error: {error}")
        raise
    store.audit("me", "notify.test", "notify", {}, "ok")
