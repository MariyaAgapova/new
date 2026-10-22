@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

title Nocturnal - читательский дневник
echo.
echo ==========================================
echo   Nocturnal - читательский дневник
echo ==========================================
echo.

rem Находим node
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE (
  if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
  if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
  if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE=%LocalAppData%\Programs\nodejs\node.exe"
)
if not defined NODE (
  echo [ОШИБКА] Node.js не найден.
  echo Установите Node.js с https://nodejs.org
  echo.
  pause
  exit /b 1
)
echo Node: %NODE%

rem Устанавливаем зависимости при первом запуске
if not exist "node_modules" (
  echo Устанавливаю зависимости...
  call "%NODE%\..\npm.cmd" install
  if errorlevel 1 (
    echo [ОШИБКА] Не удалось установить зависимости.
    pause
    exit /b 1
  )
  echo.
)

rem Открываем браузер
echo.
echo ==========================================
echo   Сервер запускается на:
echo   Локально:  http://localhost:3000
echo   В сети:    http://192.168.10.7:3000
echo.
echo   Для доступа ИЗ ИНТЕРНЕТА второму человеку
echo   откройте tunnel.bat - создастся публичная ссылка.
echo ==========================================
echo.
echo Закройте это окно, чтобы остановить сервер.
echo.
start "" http://localhost:3000

rem Запускаем сервер (останется открытым)
"%NODE%" server.js

echo.
echo Сервер остановлен.
pause
