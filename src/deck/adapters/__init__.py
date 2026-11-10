from ..config import Config
from .base import Adapter, Conversation, Message
from .channel import ChannelAdapter
from .dingtalk import DingTalkAdapter

__all__ = ["Adapter", "Conversation", "Message", "SOURCES", "adapter_for"]

SOURCES = ("dingtalk", "channel")


def adapter_for(source: str, config: Config) -> Adapter:
    if source == "dingtalk":
        return DingTalkAdapter(config.tools["dws"])
    if source == "channel":
        return ChannelAdapter(config.tools["drlee"])
    raise ValueError(f"不认识的数据源 {source}，可选：{', '.join(SOURCES)}")
