"""网页接口测试共用的假数据和客户端；夹具在 conftest.py。"""
import io
import json
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from deck import access
from deck.adapters.base import Conversation, Message
from deck.sync import sync

# 跟着当前时间走：待处理只看保留期限内的消息。
NOW = datetime.now(timezone.utc).replace(second=0, microsecond=0)


def _msg(id, sender, text, minutes_ago, conversation="cid"):
    name = {"ME": "李涛", "BOT": "management-x-dev"}.get(sender, "张三")
    return Message("dingtalk", id, conversation, sender, name, text,
                   NOW - timedelta(minutes=minutes_ago))


class Adapter:
    source = "dingtalk"

    def __init__(self, messages):
        self.messages = messages

    def resolve(self, query):
        return Conversation("dingtalk", "cid", query)

    def fetch(self, conversation, cursor):
        return self.messages, "c"

    def send(self, conversation, text, reply_to=None, ai=False):
        pass

    def self_ids(self, conversation):
        return {"ME"}


def _fill(store, messages):
    sync(store, lambda _: Adapter(messages))


class FakeProc:
    def __init__(self, stdout_lines, stderr_lines):
        self.stdout = io.StringIO("".join(stdout_lines))
        self.stderr = io.StringIO("".join(stderr_lines))
        self.returncode = None

    def wait(self, timeout=None):
        self.returncode = 0
        return 0

    def poll(self):
        return self.returncode

    def terminate(self):
        self.returncode = -15


class Client:
    def __init__(self, port):
        self.port = port
        self.cookie = None

    def __call__(self, method, path, body=None, headers=None):
        headers = {"Content-Type": "application/json", **(headers or {})}
        if self.cookie:
            headers["Cookie"] = self.cookie
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}", method=method,
            data=json.dumps(body).encode() if body is not None else None, headers=headers,
        )
        try:
            with urllib.request.urlopen(request) as response:
                self._remember(response.headers)
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def _remember(self, headers):
        for value in headers.get_all("Set-Cookie") or []:
            self.last_set_cookie = value
            pair = value.split(";")[0]
            self.cookie = None if pair.endswith("=") else pair

    def login(self, store):
        code, _ = access.create_pairing(store)
        return self("POST", "/api/session", {"code": code}, {"X-Deck": "1"})
