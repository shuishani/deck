"""提醒规则只影响待处理状态，不改变消息采集和保存。"""

import json
import re
from datetime import datetime

DEFAULT = {"scope": "all", "keywords": [], "quiet_start": None, "quiet_end": None}


def decode(raw: str | None) -> dict:
    return {**DEFAULT, **(json.loads(raw) if raw else {})}


def validate(data: dict) -> dict:
    if set(data) - set(DEFAULT):
        raise ValueError("未知的提醒规则字段")
    result = {**DEFAULT, **data}
    if result["scope"] not in ("all", "mentions", "keywords", "off"):
        raise ValueError("提醒范围须为 all / mentions / keywords / off")
    words = result["keywords"]
    if not isinstance(words, list) or len(words) > 100 or any(
        not isinstance(w, str) or not w.strip() or len(w) > 100 for w in words
    ):
        raise ValueError("关键词须为非空文本列表")
    result["keywords"] = list(dict.fromkeys(w.strip() for w in words))
    if result["scope"] == "keywords" and not result["keywords"]:
        raise ValueError("按关键词提醒时，至少填写一个关键词")
    for key in ("quiet_start", "quiet_end"):
        value = result[key]
        if value is not None and (not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value)):
            raise ValueError("安静时段须为 HH:MM")
    if (result["quiet_start"] is None) != (result["quiet_end"] is None):
        raise ValueError("安静时段的开始和结束时间须同时填写")
    return result


def quiet(rule: dict, now: datetime) -> bool:
    start, end = rule["quiet_start"], rule["quiet_end"]
    if start is None:
        return False
    clock = now.astimezone().strftime("%H:%M")
    return start <= clock < end if start < end else clock >= start or clock < end
