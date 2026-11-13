"""持久化发送草稿：确认绑定内容和设备，同一操作最多调用一次平台。"""

import json
import uuid
from datetime import datetime, timedelta, timezone

from . import actions, uploads
from .config import Config
from .runner import ToolError
from .store import Store


def preview(store: Store, config: Config, owner: str, payload: dict) -> dict:
    items = uploads.prepare(store, owner, payload["group"], payload.get("attachments", []))
    _, plan = actions.plan_send(store, config, payload["group"], payload["text"],
                                payload["reply_to"], payload["ai"], items)
    handle = payload.get("handle")
    if handle is not None:
        message = store.message(handle)
        if not message or message["conversation"] != payload["group"]:
            raise ValueError("只能处理当前群中的消息")
    id = uuid.uuid4().hex
    expires = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(timespec="seconds")
    store.create_send(id, owner, payload, plan, expires)
    return {**plan, "operation_id": id, "expires_at": expires}


def confirm(store: Store, config: Config, adapter_for, owner: str, id: str, body: dict) -> dict:
    row = store.send_operation(id, owner)
    if not row:
        raise LookupError("发送草稿不存在，请重新预览")
    payload = json.loads(row["payload"])
    if any(key in body and body[key] != value for key, value in payload.items()):
        raise ValueError("发送内容与预览不一致，请重新预览")
    if row["result"]:
        return json.loads(row["result"])
    if row["status"] == "draft":
        if datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc):
            raise ValueError("草稿已过期，请重新预览")
        items = uploads.prepare(store, owner, payload["group"], payload.get("attachments", []))
        _, current = actions.plan_send(store, config, payload["group"], payload["text"],
                                       payload["reply_to"], payload["ai"], items)
        if current != json.loads(row["preview"]):
            raise ValueError("群或发送设置已变化，请重新预览")
    if not store.claim_send(id):
        row = store.send_operation(id, owner)
        if row["result"]:
            return json.loads(row["result"])
        return {"operation_id": id, "status": "sending", "sent": False,
                "message_id": None, "sync_error": None,
                "error": "发送处理中或结果待核实，请先查看群消息，勿重复发送"}
    try:
        result = actions.send(store, config, adapter_for, payload["group"], payload["text"],
                              payload["reply_to"], payload["ai"], handle=payload.get("handle"), attachments=items)
    except ToolError as error:
        # 只有单条命令明确失败才能断定没发出；带附件会分多步发送，前面的可能已成功。
        if error.definite and not items:
            result = {"status": "failed", "sent": False, "message_id": None, "sync_error": None,
                      "error": f"发送失败：{error}。可返回修改后重新发送"}
        else:
            result = _unknown(str(error))
    except ValueError as error:
        result = _unknown(str(error))
    except Exception as error:  # noqa: BLE001 - 平台可能已经接受；保留操作记录，绝不自动重发。
        result = _unknown(type(error).__name__)
    result["operation_id"] = id
    store.finish_send(id, result)
    return result


def _unknown(detail: str) -> dict:
    return {"status": "unknown", "sent": False, "message_id": None, "sync_error": None,
            "error": f"发送结果未知（{detail}），请先在群里核实；此操作不会自动重发"}
