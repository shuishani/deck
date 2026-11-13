from ..config import Config
from .base import Adapter, Conversation, Message
from .channel import ChannelAdapter
from .dingtalk import DingTalkAdapter

__all__ = ["MARKS_AI", "Adapter", "Conversation", "Message", "SOURCES", "adapter_for"]

SOURCES = ("dingtalk", "channel")
# 平台自己会给 AI 发的消息打标记（钉钉「通过 AI 发送」、channel「拍档」），不用再加文字前缀。
MARKS_AI = {"dingtalk", "channel"}


def adapter_for(source: str, config: Config) -> Adapter:
    if source == "dingtalk":
        return DingTalkAdapter(config.tools["dws"])
    if source == "channel":
        return ChannelAdapter(config.tools["drlee"], sender=config.tools.get("drlee_send") or None)
    raise ValueError(f"不支持的数据源 {source}，可选：{', '.join(SOURCES)}")
