@echo off
cd /d "%~dp0"
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 exit /b 1
)
echo CMG 3D / 4D: http://localhost:5173
call npm.cmd run dev -- --port 5173 --strictPort
