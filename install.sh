#!/usr/bin/env bash
set -euo pipefail

VER="0.7.11"
INSTALL_LIB="/usr/local/lib/sapni"
INSTALL_BIN="/usr/local/bin/sapni"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; NC='\033[0m'

command -v node &>/dev/null || { echo -e "${RED}Node.js not found. Install Node.js >= 18: https://nodejs.org${NC}"; exit 1; }

NEED_SUDO=""
if [ ! -w "/usr/local/lib" ] || [ ! -w "/usr/local/bin" ]; then
  command -v sudo &>/dev/null || { echo -e "${RED}sudo required to write to /usr/local${NC}"; exit 1; }
  NEED_SUDO="sudo"
fi

echo ""
echo -e "  ${CYAN}============================================${NC}"
echo -e "  ${CYAN}  Sapni v${VER} — 强力安装 (Unix)${NC}"
echo -e "  ${CYAN}============================================${NC}"
echo ""

OLD_KEY=""
if [ -f "$INSTALL_LIB/config.json" ]; then
  OLD_KEY=$(node -e "try{process.stdout.write(require('$INSTALL_LIB/config.json').llm?.apiKey||'')}catch(e){}" 2>/dev/null)
fi

echo -e "  ${YELLOW}正在清除旧安装...${NC}"

$NEED_SUDO rm -rf "$INSTALL_LIB" 2>/dev/null || true
$NEED_SUDO rm -f "$INSTALL_BIN" 2>/dev/null || true
$NEED_SUDO rm -f "/usr/bin/sapni" 2>/dev/null || true
$NEED_SUDO rm -f "/usr/local/sbin/sapni" 2>/dev/null || true

echo -e "  ${YELLOW}正在清理旧 PATH 条目...${NC}"
for RC in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  if [ -f "$RC" ]; then
    sed -i.bak '/# Sapni PATH/d' "$RC" 2>/dev/null || true
    sed -i.bak '/sapni/d' "$RC" 2>/dev/null || true
    rm -f "${RC}.bak" 2>/dev/null || true
  fi
done

echo -e "  ${CYAN}正在复制文件到 ${INSTALL_LIB}${NC}"
$NEED_SUDO mkdir -p "$INSTALL_LIB"
for D in Src Tools Mem Logos bin; do
  if [ -d "$SCRIPT_DIR/$D" ]; then
    $NEED_SUDO cp -r "$SCRIPT_DIR/$D" "$INSTALL_LIB/"
  fi
done
$NEED_SUDO cp "$SCRIPT_DIR/config.json" "$INSTALL_LIB/config.json"
$NEED_SUDO mkdir -p "$INSTALL_LIB/Tools/custom"

if [ -n "$OLD_KEY" ] && [ "$OLD_KEY" != "YOUR_API_KEY" ] && [ "$OLD_KEY" != "YOUR_DEEPSEEK_API_KEY_HERE" ]; then
  echo -e "  ${YELLOW}正在恢复旧 API Key...${NC}"
  $NEED_SUDO node -e "
    const fs=require('fs');
    const cfg=JSON.parse(fs.readFileSync('$INSTALL_LIB/config.json','utf-8'));
    cfg.llm.apiKey='$OLD_KEY';
    fs.writeFileSync('$INSTALL_LIB/config.json',JSON.stringify(cfg,null,2));
  "
fi

$NEED_SUDO bash -c "cat > $INSTALL_BIN" << 'LAUNCHER'
#!/usr/bin/env bash
exec node /usr/local/lib/sapni/Src/index.js "$@"
LAUNCHER
$NEED_SUDO chmod +x "$INSTALL_BIN"

echo ""
echo -e "  ${GREEN}============================================${NC}"
echo -e "  ${GREEN}  安装完成! 输入 sapni 即可启动${NC}"
echo -e "  ${GREEN}============================================${NC}"
echo ""
echo -e "  运行:       ${CYAN}sapni${NC}"
echo -e "  配置:       ${CYAN}${INSTALL_LIB}/config.json${NC}"
echo -e "  卸载:       ${CYAN}sudo rm -rf ${INSTALL_LIB} ${INSTALL_BIN}${NC}"
echo ""
