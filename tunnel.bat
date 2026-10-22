@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

title Nocturnal - публичный доступ
echo ==========================================
echo   Nocturnal - публичный доступ
echo ==========================================
echo.

rem Ищем cloudflared
set "CF="
where cloudflared >nul 2>nul && set "CF=cloudflared"
if not defined CF (
  if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
  if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
)
if not defined CF (
  echo [ОШИБКА] cloudflared не найден.
  echo Установите его командой:
  echo   winget install --id Cloudflare.cloudflared
  echo.
  pause
  exit /b 1
)

rem Проверяем, что сервер запущен
echo Проверяю сервер на http://localhost:3000 ...
curl -s -o nul http://localhost:3000
if errorlevel 1 (
  echo [ОШИБКА] Сервер не запущен. Сначала запустите start.bat
  pause
  exit /b 1
)

echo.
echo Публичный доступ запускается...
echo.

rem Запускаем туннель в фоне, лог пишем в C:\Users\Public (путь БЕЗ кириллицы)
set "LOG=%PUBLIC%\nocturnal_tunnel.log"
del /q "%LOG%" 2>nul
start "Nocturnal-туннель" cmd /c ""%CF%" tunnel --url http://localhost:3000 --no-autoupdate > "%LOG%" 2>&1"

rem Ждём появления ссылки (до 40 сек)
set "URL="
set /a tries=0
:wait
set /a tries+=1
if defined URL goto :goturl
for /f "tokens=4" %%u in ('findstr /c:"https://" "%LOG%" 2^>nul ^| findstr /c:"trycloudflare.com"') do set "URL=%%u"
if not defined URL (
  if %tries% lss 40 (
    ping -n 2 127.0.0.1 >nul
    goto wait
  )
)
:goturl
set "CLEAN=%URL%"
echo ==========================================================
echo.
if defined CLEAN (
  echo   ГОТОВО! Отправьте эту ссылку второму человеку:
  echo.
  echo      %CLEAN%
  echo.
  echo   Ссылка также сохранена в файле: link.txt
  > "%PUBLIC%\link.txt" echo %CLEAN%
  > "link.txt" echo %CLEAN%
) else (
  echo   [ОШИБКА] Не удалось получить ссылку за 40 секунд.
  echo   Проверьте интернет и лог: %LOG%
)
echo.
echo ==========================================================
echo.
echo Туннель работает в фоне (окно "Nocturnal-туннель").
echo Чтобы остановить - закройте то окно в панели задач.
echo.
pause
