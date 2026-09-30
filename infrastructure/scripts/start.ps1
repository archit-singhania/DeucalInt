param([switch]$Rebuild)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $taskRoot
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskNpm = Join-Path (Split-Path $taskNode) 'npm.cmd'
if (-not (Test-Path -LiteralPath $taskNpm)) { $taskNpm = (Get-Command npm -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules'))) {
  & $taskNpm ci
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
}
if ($Rebuild -or -not (Test-Path -LiteralPath (Join-Path $taskRoot 'dist\dashboard\index.html'))) {
  & $taskNpm run build
  if ($LASTEXITCODE -ne 0) { throw 'Dashboard build failed' }
}
Write-Output 'Open http://127.0.0.1:8100. Press Ctrl+C to stop.'
python apps/local-api/server.py
