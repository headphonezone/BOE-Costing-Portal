# Starts both services, each in its own window.
#   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Starting parser  -> http://127.0.0.1:8000"
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$rootrontendpi'; python -m uvicorn _boe.main:app --host 127.0.0.1 --port 8000"
)

Start-Sleep -Seconds 2

Write-Host "Starting portal  -> http://localhost:3000"
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$root\frontend'; npm run dev"
)

Write-Host ""
Write-Host "Both starting. Close the two windows to stop them."
