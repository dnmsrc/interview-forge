#!/usr/bin/env bash
# 冒烟对照实验：确认哪种 Chromium 开关组合能让 Electron 在本机稳定起来。
# 用法：bash scripts/smoke.sh   （每例 14 秒，输出体积 + 渲染层日志命中数 + 进程存活）
set -u
cd "$(dirname "$0")/.."

run_case() {
  local name="$1"
  shift
  local out="/tmp/eforge-$name.out"
  rm -f "$out"
  env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe --enable-logging=stderr "$@" out/main/index.js >"$out" 2>&1 &
  local pid=$!
  sleep 14
  local bytes hits alive
  bytes=$(wc -c <"$out")
  hits=$(grep -c "CONSOLE" "$out" || true)
  if kill -0 "$pid" 2>/dev/null; then alive=yes; else alive=no; fi
  echo "case=$name bytes=$bytes console_hits=$hits alive=$alive args=[$*]"
  grep -m3 -Ei "FATAL|CHECK failure|CHECK failed|fatal error" "$out" | cut -c1-170
  kill -9 "$pid" >/dev/null 2>&1 || true
  sleep 1
}

run_case nosandbox --no-sandbox
run_case nogpu --disable-gpu
run_case plain
echo "--- 清理残留 ---"
