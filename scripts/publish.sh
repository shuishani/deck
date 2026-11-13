#!/bin/sh
# 把当前工作区构建成独立副本，装给后台服务用；仓库里改代码、重建前端都要跑这个脚本才会上线。
#   --no-web   不重建前端，直接打包现有的 src/deck/static
#   --restart  安装后重新加载后台服务并自检；自检失败自动回滚到上一版和原来的 launchd 配置
set -eu
cd "$(dirname "$0")/.."

web=1
restart=0
for arg in "$@"; do
  case $arg in
    --no-web) web=0 ;;
    --restart) restart=1 ;;
    *) echo "未知参数：$arg（可用 --no-web、--restart）" >&2; exit 2 ;;
  esac
done

umask 077
home=${DECK_HOME:-$HOME/.deck}
label=${DECK_SERVICE_LABEL:-dev.deck.server}
plist=${DECK_SERVICE_PLIST:-$HOME/Library/LaunchAgents/$label.plist}
releases=$home/releases
bin=$(uv tool dir --bin)/deck
python=$(uv tool dir)/deck/bin/python
domain=gui/$(id -u)
log=$home/logs/server.out.log
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# 构建、安装
if [ "$web" = 1 ]; then (cd web && pnpm build); fi
uv build --wheel --out-dir "$work/wheel" --quiet
if ! unzip -l "$work"/wheel/deck-*.whl | grep -q 'deck/static/index.html'; then
  echo "包里缺少前端产物 deck/static，已停止" >&2
  exit 1
fi
uv tool install --force --reinstall --quiet "$work"/wheel/deck-*.whl
mkdir -p "$releases" "$home/logs"
rm -rf "$releases/previous"
if [ -d "$releases/current" ]; then mv "$releases/current" "$releases/previous"; fi
mv "$work/wheel" "$releases/current"
echo "已安装：$bin"

if [ "$restart" = 0 ]; then
  echo "重新加载后台服务后生效：scripts/publish.sh --no-web --restart，或 launchctl kickstart -k $domain/$label"
  exit 0
fi

render_plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$bin</string><string>serve</string></array>
  <key>WorkingDirectory</key><string>$home</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DECK_HOME</key><string>$home</string>
    <key>HOME</key><string>$HOME</string>
    <key>PATH</key><string>$(dirname "$bin"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PYTHONUNBUFFERED</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>$home/logs/server.out.log</string>
  <key>StandardErrorPath</key><string>$home/logs/server.err.log</string>
</dict>
</plist>
EOF
}

loaded() { launchctl print "$domain/$label" >/dev/null 2>&1; }

service_pid() { launchctl print "$domain/$label" 2>/dev/null | awk '$1 == "pid" { print $3; exit }'; }

# plist 改过就整个重新加载（kickstart 不会重读 plist），否则只重启进程。
reload() {
  if [ "$1" = 1 ] || ! loaded; then
    if loaded; then
      launchctl bootout "$domain/$label" 2>/dev/null || true
      i=0
      while loaded && [ $i -lt 40 ]; do sleep 1; i=$((i + 1)); done
    fi
    if [ -f "$plist" ]; then launchctl bootstrap "$domain" "$plist"; fi
  else
    launchctl kickstart -k "$domain/$label"
  fi
}

status_of() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1" || true; }

check() {
  if ! port=$("$python" -c 'from deck import config; print(config.load().server.port)' 2>/dev/null); then
    echo "读取 deck 配置失败，可运行 $bin config show 查看原因" >&2
    return 1
  fi
  code=000
  i=0
  while [ "$code" != 200 ] && [ $i -lt 30 ]; do
    sleep 1
    code=$(status_of "http://127.0.0.1:$port/")
    i=$((i + 1))
  done
  if [ "$code" != 200 ]; then echo "本机地址 http://127.0.0.1:$port/ 返回 $code" >&2; return 1; fi
  entry=$(sqlite3 -readonly "$home/deck.db" "SELECT json_extract(value, '\$.url') FROM settings WHERE key = 'access_entry'" 2>/dev/null || true)
  if [ -n "$entry" ]; then
    code=$(status_of "$entry")
    if [ "$code" != 200 ]; then echo "固定入口 $entry 返回 $code" >&2; return 1; fi
  fi
  # 等一会儿再看进程有没有换过，排除启动后立刻崩溃、被 launchd 反复拉起的情况。
  pid=$(service_pid)
  sleep 5
  if [ -z "$pid" ] || [ "$pid" != "$(service_pid)" ]; then echo "服务进程没有稳定运行" >&2; return 1; fi
  # 端口返回 200 不代表是新进程在应答（可能是别的 deck 占着同一端口），要核对监听者。
  if ! lsof -a -p "$pid" -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "端口 $port 不是由服务进程 $pid 监听" >&2
    return 1
  fi
  if [ -f "$log" ]; then
    size=$(stat -f %z "$log")
    from=$((log_offset + 1))
    if [ "$size" -lt "$log_offset" ]; then from=1; fi
    if tail -c +"$from" "$log" | grep -q 'code='; then echo "日志里出现了登录码" >&2; return 1; fi
  fi
  listeners=$(pgrep -P "$pid" -f 'listen-im' | wc -l | tr -d ' ')
  echo "自检通过：本机${entry:+和固定入口}返回 200，进程 $pid 稳定运行，钉钉监听进程 $listeners 个，日志无登录码"
}

render_plist > "$work/plist"
plutil -lint -s "$work/plist"
changed=0
had_plist=0
if [ -f "$plist" ]; then had_plist=1; fi
if ! cmp -s "$work/plist" "$plist"; then
  if [ "$had_plist" = 1 ]; then
    cp -p "$plist" "$releases/launchd.plist.bak"
    echo "原 launchd 配置已备份到 $releases/launchd.plist.bak"
  fi
  cp "$work/plist" "$plist"
  changed=1
  echo "已更新 $plist"
fi

log_offset=$(stat -f %z "$log" 2>/dev/null || echo 0)
reload "$changed"
if check; then exit 0; fi

echo "自检失败，开始回滚" >&2
if [ -d "$releases/previous" ]; then
  uv tool install --force --reinstall --quiet "$releases"/previous/deck-*.whl
  rm -rf "$releases/current"
  mv "$releases/previous" "$releases/current"
  echo "已重新安装上一版" >&2
fi
if [ "$changed" = 1 ]; then
  if [ "$had_plist" = 1 ]; then
    cp -p "$releases/launchd.plist.bak" "$plist"
  else
    launchctl bootout "$domain/$label" 2>/dev/null || true
    rm -f "$plist"
  fi
  echo "已恢复原来的 launchd 配置" >&2
fi
log_offset=$(stat -f %z "$log" 2>/dev/null || echo 0)
if [ -f "$plist" ]; then
  reload "$changed"
  if check; then echo "已回滚，服务恢复运行" >&2; else echo "回滚后自检仍未通过，请手动检查" >&2; fi
fi
exit 1
