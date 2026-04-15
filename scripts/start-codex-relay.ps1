$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$appServerUrl = $env:CODEX_APP_SERVER_URL
$extensionsRoot = Join-Path $env:USERPROFILE ".vscode\extensions"

function Resolve-CodexExe() {
  $candidates = Get-ChildItem $extensionsRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "openai.chatgpt-*-win32-x64" } |
    Sort-Object Name -Descending

  foreach ($candidate in $candidates) {
    $exe = Join-Path $candidate.FullName "bin\windows-x86_64\codex.exe"
    if (Test-Path $exe) {
      return $exe
    }
  }

  return $null
}

$codexExe = Resolve-CodexExe

if ([string]::IsNullOrWhiteSpace($appServerUrl)) {
  $appServerUrl = "ws://127.0.0.1:4500"
}

if (-not (Test-Path $codexExe)) {
  throw "Codex executable not found under: $extensionsRoot"
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
