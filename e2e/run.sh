#!/usr/bin/env bash
# 端到端冒烟：启动 dev server → Playwright(Chromium) 跑 e2e/smoke.ts → 关闭
set -e
cd "$(dirname "$0")/.."

PORT=5199
BASE="http://localhost:$PORT"

# 若 Chromium 缺系统库且无法 apt 安装（无 root 沙箱），可用本地解压的 arm64 库：
#   mkdir -p /tmp/chromelibs && cd /tmp/chromelibs
#   for u in n/nspr n/nss ...; do curl -sO http://deb.debian.org/debian/pool/main/$u/<deb>; done
#   for d in *.deb; do dpkg-deb -x "$d" extracted; done
if [ -d /tmp/chromelibs/extracted ]; then
  export LD_LIBRARY_PATH="/tmp/chromelibs/extracted/usr/lib/aarch64-linux-gnu:/tmp/chromelibs/extracted/lib/aarch64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# 已在运行就复用，否则自己起一个并在退出时清理
if curl -s -o /dev/null "$BASE/"; then
  npx tsx e2e/smoke.ts
else
  npx vite --port "$PORT" >/tmp/dcw-vite.log 2>&1 &
  VITE_PID=$!
  trap 'kill $VITE_PID 2>/dev/null || true' EXIT
  for _ in $(seq 1 30); do
    curl -s -o /dev/null "$BASE/" && break
    sleep 1
  done
  npx tsx e2e/smoke.ts
fi
