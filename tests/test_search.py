import importlib
import importlib.util
from datetime import datetime, timedelta, timezone

import pytest

from deck.adapters.base import Conversation, Message
from deck.config import Config
from deck.store import Store


def search_module():
    assert importlib.util.find_spec('deck.search') is not None
    return importlib.import_module('deck.search')


@pytest.fixture
def data(tmp_path):
    store = Store(tmp_path / 'deck.db')
    store.add_project('p', '项目', None)
    group = store.add_conversation('p', Conversation('channel', 'c', '测试群'))
    now = datetime.now(timezone.utc)
    store.add_messages(group, [Message('channel', str(i), 'c', 'other', '用户',
        f'早期登录失败 {i}' if i < 5 else f'普通消息 {i}', now + timedelta(seconds=i)) for i in range(220)], {'me'})
    yield store, Config(home=tmp_path)
    store.close()


def test_search_finds_old_messages_and_pages_without_duplicates(data):
    search = search_module()
    store, config = data
    first = search.messages(store, config, '登录失败', limit=2)
    assert len(first['hits']) == 2 and first['next_cursor']
    second = search.messages(store, config, '登录失败', limit=2, cursor=first['next_cursor'])
    assert len(second['hits']) == 2
    assert not {h['message']['id'] for h in first['hits']} & {h['message']['id'] for h in second['hits']}
    third = search.messages(store, config, '登录失败', limit=2, cursor=second['next_cursor'])
    assert len(third['hits']) == 1 and third['next_cursor'] is None
    assert '登录失败' in first['hits'][0]['excerpt']


def test_search_treats_wildcards_literally_and_validates_cursor_scope(data):
    search = search_module()
    store, config = data
    assert search.messages(store, config, '%')['hits'] == []
    assert search.messages(store, config, '_')['hits'] == []
    page = search.messages(store, config, '登录失败', limit=1)
    with pytest.raises(ValueError):
        search.messages(store, config, '普通消息', cursor=page['next_cursor'])
    with pytest.raises(ValueError):
        search.messages(store, config, '登录失败', cursor='invalid')


def test_around_reads_context_for_old_message(data):
    search = search_module()
    store, _ = data
    rows = search.around(store, 3, group=1, limit=10)
    assert any(r['id'] == 3 for r in rows)
    assert len(rows) <= 10
    with pytest.raises(LookupError):
        search.around(store, 3, group=999, limit=10)
