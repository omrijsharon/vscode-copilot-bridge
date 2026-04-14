param(
  [string]$TunnelName = "codex-remote-relay",
  [string]$PublicBaseUrl = "",
  [string]$RelayPort = "8788",
  [string]$AppServerUrl = "ws://127.0.0.1:4500",
  [string]$SessionSecret = "",
  [switch]$ForceRestart
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$cloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$appServerPort = ([Uri]$AppServerUrl).Port
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

if ([string]::IsNullOrWhiteSpace($PublicBaseUrl)) {
  $PublicBaseUrl = $env:CODEX_RELAY_BASE_URL
}

if ([string]::IsNullOrWhiteSpace($SessionSecret)) {
  $SessionSecret = $env:CODEX_RELAY_SESSION_SECRET
}

if ([string]::IsNullOrWhiteSpace($PublicBaseUrl)) {
  throw "PublicBaseUrl is required. Pass -PublicBaseUrl or set CODEX_RELAY_BASE_URL."
}

if ([string]::IsNullOrWhiteSpace($SessionSecret)) {
  throw "SessionSecret is required. Pass -SessionSecret or set CODEX_RELAY_SESSION_SECRET."
}

if (-not (Test-Path $codexExe)) {
  throw "Codex executable not found under: $extensionsRoot"
}

if (-not (Test-Path $cloudflaredExe)) {
  throw "cloudflared executable not found at: $cloudflaredExe"
}

function Get-ListeningProcessId([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    return $conn.OwningProcess
  }
  return $null
}

function Get-ProcessDetails([int]$ProcessId) {
  if (-not $ProcessId) {
    return $null
  }
  try {
    return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
  } catch {
    return $null
  }
}

function Stop-ListeningProcess([int]$Port, [string]$Reason) {
  $pid = Get-ListeningProcessId $Port
  if (-not $pid) {
    return $false
  }
  Write-Host "Stopping process on port $Port ($Reason), PID=$pid"
  Stop-Process -Id $pid -Force -ErrorAction Stop
  Start-Sleep -Seconds 2
  return $true
}

function Test-RelayHealth([string]$BaseUrl) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing "$BaseUrl/health" -TimeoutSec 4
    if (-not $response.Content) {
      return $false
    }
    $json = $response.Content | ConvertFrom-Json
    return $json.ok -eq $true
  } catch {
    return $false
  }
}

function Test-AppServerHealth([string]$BaseUrl) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing "$BaseUrl/health" -TimeoutSec 4
    if (-not $response.Content) {
      return $false
    }
    $json = $response.Content | ConvertFrom-Json
    return $json.appServer.status -eq "ok"
  } catch {
    return $false
  }
}

function Get-ExistingCloudflaredTunnelProcess([string]$ExpectedTunnelName) {
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue
  foreach ($proc in $procs) {
    $cmd = $proc.CommandLine
    if ($cmd -and $cmd -match "tunnel run" -and $cmd -match [regex]::Escape($ExpectedTunnelName)) {
      return $proc
    }
  }
  return $null
}

function Start-PowerShellWindow([string]$ScriptBody) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ScriptBody))
  Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-EncodedCommand",
    $encoded
  ) | Out-Null
}

function Start-AppServer() {
  Write-Host "Starting codex app-server..."
  $command = @"
& '$codexExe' app-server --listen '$AppServerUrl'
"@
  Start-PowerShellWindow $command
  Start-Sleep -Seconds 3
}

function Start-Relay() {
  Write-Host "Starting codex remote relay..."
  $relayCommand = @"
Set-Location '$repoRoot'
`$env:CODEX_RELAY_HOST='127.0.0.1'
`$env:CODEX_RELAY_PORT='$RelayPort'
`$env:CODEX_RELAY_BASE_URL='$PublicBaseUrl'
`$env:CODEX_APP_SERVER_URL='$AppServerUrl'
`$env:CODEX_RELAY_SESSION_SECRET='$SessionSecret'
npm.cmd run build
node .\out\relay\server.js
"@
  Start-PowerShellWindow $relayCommand
  Start-Sleep -Seconds 4
}

function Start-Tunnel() {
  Write-Host "Starting Cloudflare tunnel..."
  $command = @"
& '$cloudflaredExe' tunnel run --url 'http://localhost:$RelayPort' '$TunnelName'
"@
  Start-PowerShellWindow $command
  Start-Sleep -Seconds 3
}

$reuseAppServer = $false
$reuseRelay = $false
$reuseTunnel = $false

$appServerPid = Get-ListeningProcessId $appServerPort
if ($appServerPid -and -not $ForceRestart) {
  $appDetails = Get-ProcessDetails $appServerPid
  if ($appDetails -and $appDetails.CommandLine -match [regex]::Escape("app-server --listen $AppServerUrl")) {
    Write-Host "Reusing running app-server on port $appServerPort (PID=$appServerPid)."
    $reuseAppServer = $true
  } else {
    Stop-ListeningProcess -Port $appServerPort -Reason "conflicting listener"
  }
}
if (-not $reuseAppServer) {
  Start-AppServer
}

$relayPid = Get-ListeningProcessId ([int]$RelayPort)
if ($relayPid -and -not $ForceRestart) {
  if (Test-RelayHealth $PublicBaseUrl) {
    Write-Host "Reusing running relay on port $RelayPort (PID=$relayPid)."
    $reuseRelay = $true
  } else {
    Stop-ListeningProcess -Port ([int]$RelayPort) -Reason "unhealthy relay listener"
  }
}
if (-not $reuseRelay) {
  Start-Relay
}

$existingTunnel = Get-ExistingCloudflaredTunnelProcess $TunnelName
if ($existingTunnel -and -not $ForceRestart) {
  Write-Host "Reusing running Cloudflare tunnel '$TunnelName' (PID=$($existingTunnel.ProcessId))."
  $reuseTunnel = $true
} elseif ($existingTunnel -and $ForceRestart) {
  Write-Host "Stopping existing Cloudflare tunnel '$TunnelName' (PID=$($existingTunnel.ProcessId))."
  Stop-Process -Id $existingTunnel.ProcessId -Force -ErrorAction Stop
  Start-Sleep -Seconds 2
}
if (-not $reuseTunnel) {
  Start-Tunnel
}

Write-Host ""
Write-Host "Stack status:"
Write-Host "  Public URL: $PublicBaseUrl"
Write-Host "  Operator: $PublicBaseUrl/operator"
Write-Host "  Remote client: $PublicBaseUrl/"
Write-Host "  App-server healthy: $(Test-AppServerHealth $PublicBaseUrl)"
Write-Host "  Relay healthy: $(Test-RelayHealth $PublicBaseUrl)"
