#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "此脚本用于 macOS；其他平台请按 HANDOFF.md 准备。" >&2
  exit 1
fi

for tool in node npm uv codex; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "缺少 $tool，请先安装并确保当前终端 PATH 可找到它。" >&2
    exit 1
  fi
done

node --input-type=module -e '
if (Number(process.versions.node.split(".")[0]) !== 24) {
  console.error("请使用交接基线的 Node.js 24，再执行环境准备。");
  process.exit(1);
}
'

# Runtime installation stays with the user; uv must only select an installed Python.
PYTHON_PATH="$(uv python find 3.13 --no-python-downloads --cache-dir .tmp/uv-cache)"
node --version
npm --version
"$PYTHON_PATH" --version
codex --version

npm ci --cache .tmp/npm-cache
if [[ ! -x .tmp/hardware-venv/bin/python ]]; then
  uv venv .tmp/hardware-venv --python "$PYTHON_PATH" \
    --no-python-downloads --cache-dir .tmp/uv-cache
fi
.tmp/hardware-venv/bin/python - <<'PY'
import sys

if sys.version_info[:2] != (3, 13):
    sys.exit("已有 .tmp/hardware-venv 不是 Python 3.13；请移走旧环境后重新执行准备脚本。")
PY
uv pip install --python .tmp/hardware-venv/bin/python --cache-dir .tmp/uv-cache \
  esptool==5.4.0 platformio==6.2.0 pyserial

npm test
npm run build
npm run test:contract

# Generate hooks only after the user's final Node executable path is known.
npm run hooks:install
.tmp/hardware-venv/bin/python -m serial.tools.list_ports -v

echo "依赖和检查已完成。请在本项目的交互式 Codex CLI 中用 /hooks 审核并信任通知定义。"
echo "随后在一个终端运行 npm start，另一个终端运行 npm run doctor。"
echo "固件命令使用 export PLATFORMIO_CORE_DIR=\"$PROJECT_DIR/.tmp/platformio\"。"
echo "Wi-Fi 配置、USB 设备和联网验收见 docs/macos-setup.md。"
