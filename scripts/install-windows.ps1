param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'HarnessLink\bin')
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $repoRoot 'packages\dsh-acp-bridge\dist\index.js'

if (-not (Test-Path $entry)) {
  throw "Bridge is not built. Run 'npm install; npm run build' in $repoRoot first."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw 'Node.js 22+ is required but was not found on PATH.'
}

$nodePath = $node.Source
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$shim = Join-Path $InstallDir 'dsh-acp-bridge.cmd'
$content = @"
@echo off
"$nodePath" "$entry" %*
"@
Set-Content -Path $shim -Value $content -Encoding ASCII

$readonlyShim = Join-Path $InstallDir 'dsh-acp-bridge-readonly.cmd'
$readonlyContent = @"
@echo off
set DSH_PERMISSION_MODE=read-only
"$nodePath" "$entry" %*
"@
Set-Content -Path $readonlyShim -Value $readonlyContent -Encoding ASCII

Write-Host ''
Write-Host 'HarnessLink bridge installed.' -ForegroundColor Green
Write-Host "  Normal:   $shim"
Write-Host "  Readonly: $readonlyShim"
Write-Host ''
Write-Host 'Paste one of these into Happier -> Custom ACP backend -> Command:'
Write-Host "  $shim" -ForegroundColor Cyan
Write-Host "  $readonlyShim  (use this to test approvals)" -ForegroundColor Cyan
Write-Host ''
Write-Host 'Keep Args empty, and enable "Supports session resume".'
