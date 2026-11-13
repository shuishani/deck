"""登录与设备：都依赖浏览器会话，只在网页可用。"""
from http import HTTPStatus

from .. import access
from . import ApiError, not_found, op


@op("auth.status", "GET", r"/api/auth", "read", "是否已登录、本机是否可用密码登录", open=True, web_only=True)
def auth_status(ctx, args):
    return {"authenticated": bool(ctx.session),
            "password": ctx.http.is_local() and access.has_local_password(ctx.store)}


@op("auth.login", "POST", r"/api/session", "write", "用登录码（或本机密码）登录", open=True, web_only=True)
def login(ctx, args):
    http = ctx.http
    ip = http.client_ip()
    if http.limiter.blocked(ip):
        raise ApiError(HTTPStatus.TOO_MANY_REQUESTS, "尝试次数过多，请 10 分钟后重试")
    user_agent = http.headers.get("User-Agent", "")
    if "password" in args:
        if not http.is_local():
            raise ApiError(HTTPStatus.FORBIDDEN, "密码登录仅限在本机通过 127.0.0.1 访问")
        token = access.password_login(ctx.store, str(args["password"]), user_agent, ip, http.origin())
        failure = "密码错误"
    else:
        token = access.redeem(ctx.store, str(args.get("code", "")), user_agent, ip, http.origin())
        failure = "登录码无效或已过期"
    if not token:
        http.limiter.fail(ip)
        raise ApiError(HTTPStatus.UNAUTHORIZED, failure)
    if ctx.session:
        # 同一浏览器重新登录：新 Cookie 会覆盖旧的，旧会话留着也用不上。
        access.revoke(ctx.store, ctx.session["id"])
    ctx.cookies.append(http.session_cookie(token, max_age=int(access.SESSION_TTL.total_seconds())))
    return {"ok": True}


@op("auth.logout", "DELETE", r"/api/session", "write", "退出当前设备", web_only=True)
def logout(ctx, args):
    access.revoke(ctx.store, ctx.session["id"])
    ctx.cookies.append(ctx.http.session_cookie("", max_age=0))
    return {"ok": True}


@op("access.overview", "GET", r"/api/access", "read", "已登录的设备和访问地址", web_only=True)
def overview(ctx, args):
    known = access.addresses(ctx.config)
    primary = next(a for a in known if a["recommended"])
    plan = (access.entry_plan(ctx.config, primary["url"])
            if primary["kind"] == "lan" and primary["usable"] else None)
    return {"sessions": [{**dict(r), "current": r["id"] == ctx.session["id"]} for r in access.sessions(ctx.store)],
            "addresses": known, "entry_plan": plan, "tls": ctx.http.tls}


@op("access.entry_plan", "GET", r"/api/access/entry-plan", "read", "固定入口地址的路由方案", web_only=True)
def entry_plan(ctx, args):
    return access.entry_plan(ctx.config, str(args.get("url", "")))


@op("access.pin_entry", "POST", r"/api/access/entry", "write", "固定访问入口地址", web_only=True)
def pin_entry(ctx, args):
    return access.pin_entry(ctx.store, ctx.config, str(args.get("url", "")))


@op("sessions.remove", "DELETE", r"/api/sessions/(?P<id>\d+)", "write", "移除一台已登录的设备", web_only=True)
def remove_session(ctx, args):
    id = int(args["id"])
    if not access.revoke(ctx.store, id):
        raise not_found("设备不存在")
    if id == ctx.session["id"]:
        ctx.cookies.append(ctx.http.session_cookie("", max_age=0))
    return {"ok": True}


@op("sessions.disable", "POST", r"/api/sessions/(?P<id>\d+)/(?P<action>disable|enable)", "write",
    "禁用或重新启用一台设备", web_only=True)
def disable_session(ctx, args):
    id, disable = int(args["id"]), args["action"] == "disable"
    if disable and id == ctx.session["id"]:
        raise ValueError("不能禁用当前设备；如需离开，请使用「退出登录」")
    if not access.set_disabled(ctx.store, id, disable):
        raise not_found("设备不存在")
    return {"ok": True}


@op("pairings.create", "POST", r"/api/pairings", "write", "生成一次性登录码，用来添加设备", web_only=True)
def create_pairing(ctx, args):
    code, expires = access.create_pairing(ctx.store, issued_to=ctx.http.client_ip())
    return {"code": code, "expires_at": expires.isoformat(timespec="seconds")}
