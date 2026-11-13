"""钉钉推送设置。Webhook 只能在电脑本机改：推送内容含群消息，不能让任一登录设备改去别处。"""
from http import HTTPStatus

from .. import notify
from . import ApiError, op


@op("notify.settings", "GET", r"/api/notify", "read", "钉钉推送：开关、各级别推送规则、工作时间、每日汇报、机器人是否已配置")
def get_settings(ctx, args):
    return {"settings": notify.settings(ctx.store)}


@op("notify.configure", "POST", r"/api/notify", "write", "修改推送开关、各级别规则、工作时间和每日汇报")
def configure(ctx, args):
    return {"settings": notify.configure(ctx.store, args)}


@op("notify.webhook", "POST", r"/api/notify/webhook", "write", "保存钉钉机器人 Webhook 和加签密钥（仅本机）",
    web_only=True)
def set_webhook(ctx, args):
    if not ctx.http.is_local():
        raise ApiError(HTTPStatus.FORBIDDEN, "机器人地址只能在运行 deck 的电脑上用 127.0.0.1 打开时修改")
    return {"settings": notify.set_webhook(ctx.store, str(args.get("url", "")), str(args.get("secret", "")))}


@op("notify.test", "POST", r"/api/notify/test", "write", "让机器人发一条测试消息")
def test(ctx, args):
    notify.test(ctx.store)
    return {"ok": True}
