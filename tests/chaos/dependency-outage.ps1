param([ValidateSet('clickhouse','redpanda','processor')][string]$Service='clickhouse',[int]$Seconds=20)
$ErrorActionPreference='Stop'
if ($Seconds -lt 1 -or $Seconds -gt 120) { throw 'Duration must be 1–120 seconds' }
try {
  docker compose --profile distributed stop $Service
  Write-Output "Stopped $Service. Submit traffic with benchmarks/synthetic-generator/generate.py; inspect readiness and backlog."
  Start-Sleep -Seconds $Seconds
} finally {
  docker compose --profile distributed start $Service
}
