@echo off
setlocal enabledelayedexpansion
title Sapni v0.7.11 强力安装

set "VER=0.7.11"
set "SRC=%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Node.js not found. Install Node.js ^>= 18: https://nodejs.org
    pause
    exit /b 1
)

net session >nul 2>&1
if !errorlevel! equ 0 (set "DEST=%ProgramFiles%\Sapni") else (set "DEST=%LOCALAPPDATA%\Programs\Sapni")

echo.
echo   ============================================
echo     Sapni v!VER! — 强力安装 (Win)
echo   ============================================
echo.
echo   目标目录: !DEST!

set "OLDKEY="
if exist "!DEST!\config.json" (
    for /f "tokens=1,* delims=:" %%A in ('findstr /c:"apiKey" "!DEST!\config.json"') do (
        for /f tokens^=* %%K in ("%%B") do set "OLDKEY=%%~K"
    )
    set "OLDKEY=!OLDKEY:"=!"
    set "OLDKEY=!OLDKEY: =!"
)

echo   正在清除旧安装...
if exist "!DEST!" rmdir /s /q "!DEST!" >nul 2>&1
if exist "!DEST!" (
    timeout /t 2 /nobreak >nul
    rmdir /s /q "!DEST!" >nul 2>&1
)

echo   正在清理 PATH 环境变量中的旧条目...
for %%V in (User Machine) do (
    for /f "tokens=1,* delims=;" %%A in ('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path', '%%V')" 2^>nul') do (
        set "LINE=%%A;%%B"
    )
    if defined LINE (
        set "NEWPATH="
        for %%P in ("!LINE:;=" "!") do (
            set "ENTRY=%%~P"
            set "ENTRY=!ENTRY:"=!"
            if /i not "!ENTRY!"=="!DEST!" (
                if not "!ENTRY!"=="" (
                    if not "!ENTRY!"=="/" (
                        if defined NEWPATH (set "NEWPATH=!NEWPATH!;!ENTRY!") else (set "NEWPATH=!ENTRY!")
                    )
                )
            )
        )
        powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path', '!NEWPATH!', '%%V')" >nul 2>&1
    )
)

echo   正在复制文件...
mkdir "!DEST!" >nul 2>&1

for %%D in (Src Tools Mem Logos bin) do (
    if exist "%SRC%%%D" robocopy "%SRC%%%D" "!DEST!\%%D" /E /NFL /NDL /NJH /NJS >nul 2>&1
)

copy /Y "%SRC%config.json" "!DEST!\config.json" >nul

if not "!OLDKEY!"=="" if not "!OLDKEY!"=="YOUR_API_KEY" if not "!OLDKEY!"=="YOUR_DEEPSEEK_API_KEY_HERE" (
    echo   正在恢复旧 API Key...
    powershell -NoProfile -Command "(Get-Content '!DEST!\config.json' -Raw) -replace '""apiKey"":\s*"".*?""', '""apiKey"": ""!OLDKEY!""' | Set-Content '!DEST!\config.json' -NoNewline" >nul 2>&1
)

mkdir "!DEST!\Tools\custom" >nul 2>&1

echo @echo off> "!DEST!\sapni.bat"
echo node "!DEST!\Src\index.js" %%*>> "!DEST!\sapni.bat"

echo   正在添加到 PATH...
powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';!DEST!', 'User')" >nul 2>&1

echo.
echo   ============================================
echo   安装完成! 打开新终端输入 sapni 即可启动
echo   ============================================
echo.
echo   配置: !DEST!\config.json
echo   卸载: rmdir /s /q "!DEST!"
echo.
endlocal
