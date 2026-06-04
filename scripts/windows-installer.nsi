; Sapni AI — Windows 安装程序 (NSIS)
; 编译: makensis /DVERSION=1.1.8 windows-installer.nsi

!ifndef VERSION
  !define VERSION "1.1.8"
!endif

!define PRODUCT_NAME "Sapni AI"
!define PRODUCT_VERSION "${VERSION}"
!define PRODUCT_PUBLISHER "yxpil"
!define PRODUCT_WEB_SITE "https://sapni.yxpil.com"

!include "MUI2.nsh"
!include "LogicLib.nsh"

; --- 界面设置 ---
Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "sapni-ai-${PRODUCT_VERSION}-setup.exe"
InstallDir "$PROGRAMFILES\${PRODUCT_NAME}"
RequestExecutionLevel admin
BrandingText "Sapni AI"

; --- 页面 ---
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

; --- 安装段 ---
Section "Install" SEC01
  SetOutPath "$INSTDIR"

  ; 检查 Node.js / npm
  nsExec::ExecToStack "where npm"
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP \
      "Node.js 未安装，请先安装：$\nhttps://nodejs.org (LTS 版即可)$ $\n安装完成后重新运行此安装程序。" \
      /SD IDOK
    Quit
  ${EndIf}

  ; 全局安装 sapni-ai
  DetailPrint "正在全局安装 sapni-ai (npm)..."
  nsExec::ExecToStack '"$PROGRAMFILES\nodejs\npm.cmd" install -g sapni-ai'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "npm 安装失败，请检查网络连接后重试。"
    Quit
  ${EndIf}

  ; 写入卸载信息
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "URLInfoAbout" "${PRODUCT_WEB_SITE}"
SectionEnd

; --- 卸载段 ---
Section "Uninstall"
  ; 卸载全局包
  nsExec::Exec '"$PROGRAMFILES\nodejs\npm.cmd" uninstall -g sapni-ai'

  ; 清理
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
SectionEnd
