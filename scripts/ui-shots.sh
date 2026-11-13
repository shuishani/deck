#!/bin/sh
# 用演示数据把所有页面按电脑、手机两种宽度截图：scripts/ui-shots.sh [输出目录] [页面名过滤]
# 不碰 ~/.deck，也不连接真实平台（演示库里是假的命令行工具）。
set -eu
cd "$(dirname "$0")/.."
out="${1:-/tmp/deck-shots}"
only="${2:-}"
home="$(mktemp -d /tmp/deck-shots-home.XXXXXX)"
port=18790

uv run python scripts/demo.py "$home" --port "$port" >/dev/null
(cd web && pnpm exec vite build >/dev/null)
DECK_HOME="$home" uv run deck serve --no-watch >"$home/serve.log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null; rm -rf "$home"' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -o /dev/null "http://127.0.0.1:$port/api/auth" && break
  sleep 0.5
done
link="$(DECK_HOME="$home" uv run deck --json access link --url "http://127.0.0.1:$port/" | python3 -c 'import json,sys; print(json.load(sys.stdin)["links"][0])')"
rm -rf "$out"
(cd web && node scripts/shots.mjs "$link" "$out" $only)
