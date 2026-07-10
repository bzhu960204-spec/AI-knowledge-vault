param(
  [int]$BackendPort = 8080,
  [int]$FrontendPort = 5173,
  [switch]$StopExisting = $false
)

$ErrorActionPreference = 'Stop'

function Stop-ListeningProcessByPort {
  param([int]$Port)
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    Write-Host "No listening process on port $Port"
    return
  }
  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $processIds) {
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
      Write-Host "Stopped process $processId on port $Port"
    } catch {
      Write-Host "Failed to stop process $processId on port ${Port}: $($_.Exception.Message)"
    }
  }
}

function Test-PortListening {
  param([int]$Port)
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return $null -ne $connections
}

function Get-NextAvailablePort {
  param(
    [int]$StartPort,
    [int[]]$ReservedPorts = @(),
    [int]$MaxSteps = 100
  )
  $candidate = $StartPort
  for ($i = 0; $i -le $MaxSteps; $i++) {
    if (($ReservedPorts -contains $candidate) -or (Test-PortListening -Port $candidate)) {
      $candidate++
      continue
    }
    return $candidate
  }
  throw "Could not find an available port after checking $MaxSteps ports from $StartPort"
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir  = Join-Path $scriptRoot 'backend'
$frontendDir = Join-Path $scriptRoot 'frontend'

if (-not (Test-Path $backendDir))  { throw "Backend directory not found: $backendDir" }
if (-not (Test-Path $frontendDir)) { throw "Frontend directory not found: $frontendDir" }

if ($StopExisting) {
  Stop-ListeningProcessByPort -Port $BackendPort
  Stop-ListeningProcessByPort -Port $FrontendPort
}

$requestedBackendPort  = $BackendPort
$requestedFrontendPort = $FrontendPort

$BackendPort  = Get-NextAvailablePort -StartPort $BackendPort
$FrontendPort = Get-NextAvailablePort -StartPort $FrontendPort -ReservedPorts @($BackendPort)

if ($BackendPort  -ne $requestedBackendPort)  { Write-Host "Backend port $requestedBackendPort is occupied. Switched to $BackendPort" -ForegroundColor Yellow }
if ($FrontendPort -ne $requestedFrontendPort) { Write-Host "Frontend port $requestedFrontendPort is occupied. Switched to $FrontendPort" -ForegroundColor Yellow }

Write-Host ""
Write-Host "=== AI Knowledge Vault - Dev Start ===" -ForegroundColor Cyan
Write-Host "  Backend   : http://localhost:$BackendPort" -ForegroundColor Green
Write-Host "  Frontend  : http://localhost:$FrontendPort" -ForegroundColor Green
Write-Host "  H2 Console: http://localhost:$BackendPort/h2-console" -ForegroundColor DarkGray
Write-Host ""

# --- Start backend ---
# SERVER_PORT overrides server.port; APP_CORS_ALLOWED_ORIGINS overrides app.cors.allowed-origins.
$backendJob = Start-Job -Name 'akv-backend' -ScriptBlock {
  param([string]$Dir, [int]$Port, [int]$UiPort)
  Set-Location $Dir
  $env:SERVER_PORT = $Port.ToString()
  $env:APP_CORS_ALLOWED_ORIGINS = "http://localhost:$UiPort"
  & mvn spring-boot:run 2>&1 | ForEach-Object { $_.ToString() }
} -ArgumentList $backendDir, $BackendPort, $FrontendPort

# --- Wait for backend ---
Write-Host "Waiting for backend on port $BackendPort..." -ForegroundColor Yellow
$maxWait = 120
$waited  = 0
$ready   = $false

while ($waited -lt $maxWait) {
  Receive-Job -Job $backendJob -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "[backend] $_"
  }
  if (Test-PortListening -Port $BackendPort) { $ready = $true; break }
  Start-Sleep -Seconds 1
  $waited++
  if ($waited % 10 -eq 0) {
    Write-Host "  still waiting... ($waited s)" -ForegroundColor DarkGray
  }
}

if (-not $ready) {
  Write-Host "Backend did not start within $maxWait seconds. Starting frontend anyway." -ForegroundColor Yellow
} else {
  Write-Host "Backend ready after $waited s." -ForegroundColor Green
}

# --- Start frontend ---
# BACKEND_PORT is consumed by vite.config.ts to point the /api proxy at the backend.
$frontendJob = Start-Job -Name 'akv-frontend' -ScriptBlock {
  param([string]$Dir, [int]$ApiPort, [int]$Port)
  Set-Location $Dir
  $env:BACKEND_PORT = $ApiPort.ToString()
  & npx vite --host 0.0.0.0 --port $Port 2>&1 | ForEach-Object { $_.ToString() }
} -ArgumentList $frontendDir, $BackendPort, $FrontendPort

Write-Host ""
Write-Host "Both services started. Press Ctrl+C to stop." -ForegroundColor Cyan
Write-Host "  To stop without Ctrl+C: .\stop-dev.ps1" -ForegroundColor DarkGray
Write-Host ""

try {
  while ($true) {
    $hadOutput = $false

    Receive-Job -Job $backendJob -ErrorAction SilentlyContinue | ForEach-Object {
      $hadOutput = $true
      Write-Host "[backend] $_"
    }

    Receive-Job -Job $frontendJob -ErrorAction SilentlyContinue | ForEach-Object {
      $hadOutput = $true
      Write-Host "[frontend] $_"
    }

    $backendDone  = $backendJob.State  -in @('Completed', 'Failed', 'Stopped')
    $frontendDone = $frontendJob.State -in @('Completed', 'Failed', 'Stopped')

    if ($backendDone -and -not $frontendDone) {
      Write-Host ""
      Write-Host "[!] Backend process stopped unexpectedly. Check output above." -ForegroundColor Red
    }
    if ($frontendDone -and -not $backendDone) {
      Write-Host ""
      Write-Host "[!] Frontend process stopped unexpectedly." -ForegroundColor Red
    }

    if ($backendDone -and $frontendDone) { break }

    if (-not $hadOutput) { Start-Sleep -Milliseconds 250 }
  }
}
finally {
  Write-Host ""
  Write-Host "Process states: backend=$($backendJob.State), frontend=$($frontendJob.State)" -ForegroundColor DarkGray

  if ($backendJob.State -notin @('Completed', 'Failed', 'Stopped')) {
    Stop-Job -Job $backendJob -Force -ErrorAction SilentlyContinue
  }
  if ($frontendJob.State -notin @('Completed', 'Failed', 'Stopped')) {
    Stop-Job -Job $frontendJob -Force -ErrorAction SilentlyContinue
  }

  Remove-Job -Job $backendJob, $frontendJob -Force -ErrorAction SilentlyContinue
  Write-Host "Services stopped." -ForegroundColor Yellow
}
