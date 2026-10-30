#!/bin/zsh
cd -- "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print '没有找到 Node.js。请先安装 Node.js 20 或更新版本。'
  read '?按回车关闭...'
  exit 1
fi
node server.mjs --open
if [[ $? -ne 0 ]]; then
  read '?按回车关闭...'
fi
