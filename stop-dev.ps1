param(
  [int[]]$Ports = @(8080, 5173)
)

$ErrorActionPreference = 'Continue'

foreach ($port in $Ports) {
  $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    Write-Host "No listening process on port $port"
    continue
  }

  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $processIds) {
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
      Write-Host "Stopped process $processId on port $port"
    } catch {
      Write-Host "Failed to stop process $processId on port ${port}: $($_.Exception.Message)"
    }
  }
}

# Also clean up any lingering background jobs from this session
Get-Job -Name 'akv-backend', 'akv-frontend' -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Job  $_ -Force -ErrorAction SilentlyContinue
  Remove-Job $_ -Force -ErrorAction SilentlyContinue
  Write-Host "Removed background job: $($_.Name)"
}
