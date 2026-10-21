$ErrorActionPreference = 'Stop'
node (Join-Path $PSScriptRoot 'check-codex-contract.mjs')
exit $LASTEXITCODE
