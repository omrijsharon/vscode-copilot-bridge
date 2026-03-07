$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$codexExe = "C:\Users\tamipinhasi\.vscode\extensions\openai.chatgpt-26.304.20706-win32-x64\bin\windows-x86_64\codex.exe"
$appServerUrl = $env:CODEX_APP_SERVER_URL
if ([string]::IsNullOrWhiteSpace($appServerUrl)) {
  $appServerUrl = "ws://127.0.0.1:4500"
}

if (-not (Test-Path $codexExe)) {
  throw "Codex executable not found at: $codexExe"
}

Write-Host "Starting codex app-server in a new PowerShell window..."
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "& `"$codexExe`" app-server --listen $appServerUrl"
)

Write-Host "Starting relay in the current window..."
Set-Location $repoRoot
npm.cmd run build
node .\out\relay\server.js
