from datetime import datetime, timezone

import pytest

from deck import sending, uploads
from deck.adapters.base import Conversation, Message
from deck.config import Config
from deck.store import Store


def test_attachment_only_confirmation_is_bound_and_idempotent(tmp_path):
    store = Store(tmp_path / 'deck.db')
    config = Config(home=tmp_path)
    store.add_project('p', '项目', None)
    group = store.add_conversation('p', Conversation('channel', 'c', '群'))
    file = uploads.create(store, config, 'owner', group, 'note.txt', b'hello')
    class Adapter:
        source = 'channel'
        calls = []
        def self_ids(self, _): return {'me'}
        def send_attachments(self, conversation, text, reply_to, ai, items):
            self.calls.append(items[0]['id'])
        def fetch(self, *_): return [], 'cursor'
    adapter = Adapter()
    payload = {'group': group, 'text': '', 'reply_to': None, 'ai': False, 'attachments': [file['id']]}
    plan = sending.preview(store, config, 'owner', payload)
    assert plan['attachments'][0] == file and 'path' not in str(plan)
    assert adapter.calls == []
    result = sending.confirm(store, config, lambda _: adapter, 'owner', plan['operation_id'], {})
    assert result['sent']
    assert sending.confirm(store, config, lambda _: adapter, 'owner', plan['operation_id'], {}) == result
    assert adapter.calls == [file['id']]
    with pytest.raises(ValueError):
        sending.preview(store, config, 'another-owner', payload)
    store.close()


def test_dingtalk_attachment_reply_is_rejected_before_a_send_operation(tmp_path):
    store = Store(tmp_path / 'deck.db')
    store.add_project('p', '项目', None)
    group = store.add_conversation('p', Conversation('dingtalk', 'c', '群'))
    config = Config(home=tmp_path)
    file = uploads.create(store, config, 'owner', group, 'note.txt', b'hello')
    with pytest.raises(ValueError, match='引用'):
        sending.preview(store, config, 'owner', {'group': group, 'text': 'x', 'reply_to': 'r',
            'ai': False, 'attachments': [file['id']]})
    assert store.db.execute('SELECT COUNT(*) FROM send_operations').fetchone()[0] == 0
    store.close()


def _send_setup(tmp_path, send):
    store = Store(tmp_path / 'deck.db')
    config = Config(home=tmp_path)
    store.add_project('p', '项目', None)
    group = store.add_conversation('p', Conversation('channel', 'c', '群'))

    class Adapter:
        source = 'channel'
        def self_ids(self, _): return {'me'}
        def fetch(self, *_): return [], 'cursor'

    Adapter.send = lambda self, *args, **kwargs: send()
    plan = sending.preview(store, config, 'owner', {'group': group, 'text': '收到', 'reply_to': None, 'ai': False})
    return store, sending.confirm(store, config, lambda _: Adapter(), 'owner', plan['operation_id'], {})


def test_definite_cli_failure_is_reported_as_failed_and_audited(tmp_path):
    from deck.runner import ToolError

    def fail():
        raise ToolError('drlee channel messages send 失败：无权限', definite=True)
    store, result = _send_setup(tmp_path, fail)
    assert result['status'] == 'failed' and '无权限' in result['error']
    assert store.audit_log(1)[0]['result'].startswith('error:')
    store.close()


def test_uncertain_errors_stay_unknown_but_are_audited(tmp_path):
    from deck.runner import ToolError

    def timeout():
        raise ToolError('drlee 超过 120 秒未响应')
    store, result = _send_setup(tmp_path, timeout)
    assert result['status'] == 'unknown' and '120 秒' in result['error']
    store.close()

    def crash():
        raise OSError('/secret/path')
    (tmp_path / 'b').mkdir()
    store, result = _send_setup(tmp_path / 'b', crash)
    assert result['status'] == 'unknown' and 'secret' not in result['error']
    assert store.audit_log(1)[0]['result'] == 'error: OSError'
    store.close()


def test_ai_mark_covers_every_message_of_a_split_attachment_send(tmp_path):
    from deck import actions

    store = Store(tmp_path / 'deck.db')
    config = Config(home=tmp_path)
    store.add_project('p', '项目', None)
    group = store.add_conversation('p', Conversation('dingtalk', 'c', '群'))
    file = uploads.create(store, config, 'owner', group, 'note.txt', b'hello')
    items = uploads.prepare(store, 'owner', group, [file['id']])
    pending = []

    class Adapter:
        source = 'dingtalk'
        def self_ids(self, _): return {'me'}
        def send_attachments(self, conversation, text, reply_to, ai, items):
            now = datetime.now(timezone.utc)
            pending.extend([Message('dingtalk', 'a', 'c', 'me', '我', '**说明**', now),
                            Message('dingtalk', 'b', 'c', 'me', '我', '', now)])
        def fetch(self, *_):
            out = list(pending)
            pending.clear()
            return out, 'cursor'

    result = actions.send(store, config, lambda _: Adapter(), group, '说明', None, True, attachments=items)
    assert result['message_id'] is not None and result['sync_error'] is None
    assert [r[0] for r in store.db.execute('SELECT ai_sent FROM messages ORDER BY id')] == [1, 1]
    store.close()
