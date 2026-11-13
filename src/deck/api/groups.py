"""项目、群、平台（暂停/健康状态）与手动同步。"""
from http import HTTPStatus
from urllib.parse import unquote

from .. import actions
from ..adapters import SOURCES
from ..sync import sync
from . import ApiError, op, shapes


@op("projects.list", "GET", r"/api/projects", "read", "项目列表")
def list_projects(ctx, args):
    return {"projects": [shapes.project(r) for r in ctx.store.projects()]}


@op("projects.create", "POST", r"/api/projects", "write", "新建项目：key、name，可选 repo")
def create_project(ctx, args):
    key = str(args.get("key", ""))
    actions.add_project(ctx.store, key, str(args.get("name", "")), args.get("repo"))
    return {"key": key}


@op("projects.update", "POST", r"/api/projects/(?P<project_key>[^/]+)", "write", "修改项目名称或仓库（key 不能改）")
def update_project(ctx, args):
    body = {k: v for k, v in args.items() if k != "project_key"}
    return {"project": shapes.project(actions.update_project(ctx.store, unquote(args["project_key"]), body))}


@op("groups.list", "GET", r"/api/groups", "read", "监测的群：所属项目、类型、提醒规则、监听状态")
def list_groups(ctx, args):
    paused = ctx.store.paused_sources()
    return {"groups": [shapes.group(ctx, r, paused) for r in ctx.store.conversations()]}


@op("groups.create", "POST", r"/api/groups", "write", "添加监测的群：project、source、query（群名或 ID）")
def create_group(ctx, args):
    row = actions.add_group(ctx.store, ctx.adapter_for, str(args.get("project", "")),
                            str(args.get("source", "")), str(args.get("query", "")))
    return {"id": row["id"], "name": row["name"]}


@op("groups.remove", "DELETE", r"/api/groups/(?P<id>\d+)", "write", "不再监测这个群（本地消息一并删除）")
def remove_group(ctx, args):
    actions.remove_group(ctx.store, int(args["id"]))
    return {"ok": True}


@op("groups.move", "POST", r"/api/groups/(?P<id>\d+)/project", "write", "把群移到另一个项目")
def move_group(ctx, args):
    row = actions.move_group(ctx.store, int(args["id"]), str(args.get("project", "")))
    return {"group": shapes.group(ctx, row, ctx.store.paused_sources())}


@op("groups.kind", "POST", r"/api/groups/(?P<id>\d+)/kind", "write", "设为测试群或正式群（正式群发送前多一道确认）")
def set_kind(ctx, args):
    row = actions.set_group_kind(ctx.store, int(args["id"]), str(args.get("kind", "")))
    return {"id": row["id"], "kind": row["kind"]}


@op("groups.rules", "POST", r"/api/groups/(?P<id>\d+)/rules", "write", "设置群的提醒范围、关键词和免打扰时段")
def set_rules(ctx, args):
    body = {k: v for k, v in args.items() if k != "id"}
    return {"rules": actions.set_group_rules(ctx.store, int(args["id"]), body)}


@op("sources.list", "GET", r"/api/sources", "read", "各平台：是否暂停、命令行工具版本、账号与登录状态")
def list_sources(ctx, args):
    paused = ctx.store.paused_sources()
    return {"sources": [{"source": s, "paused": s in paused, "health": ctx.health.get(s, ctx.config)}
                        for s in SOURCES]}


@op("sources.pause", "POST", r"/api/sources/(?P<source>\w+)/paused", "write", "暂停或恢复某个平台的监听")
def pause_source(ctx, args):
    actions.set_source_paused(ctx.store, args["source"], bool(args.get("paused")))
    ctx.wake_watcher()
    return {"ok": True}


@op("sync", "POST", r"/api/sync", "write", "立即拉取新消息：可按项目或平台限定")
def sync_now(ctx, args):
    source = args.get("source") or None
    if source and source in ctx.store.paused_sources():
        raise ApiError(HTTPStatus.CONFLICT, "该平台已暂停监听，恢复后再同步")
    results = sync(ctx.store, ctx.adapter_for, args.get("project") or None, source=source)
    return {"results": [{"id": r.conversation["id"], "name": r.conversation["name"],
                         "added": r.added, "error": r.error} for r in results]}
