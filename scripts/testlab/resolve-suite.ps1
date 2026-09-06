$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$suite=[string]$env:BUYFLOW_TESTLAB_REQUESTED_SUITE
if([string]::IsNullOrWhiteSpace($suite)){
  $request=Get-Content -Raw -LiteralPath 'testlab/run-request.json' | ConvertFrom-Json
  $suite=[string]$request.suite
}
if($suite -notin @('full','eventmind','identity','core')){throw "INVALID_TESTLAB_SUITE: $suite"}
if([string]::IsNullOrWhiteSpace($env:GITHUB_ENV)){throw 'GITHUB_ENV_MISSING'}
Add-Content -LiteralPath $env:GITHUB_ENV -Value ("BUYFLOW_TESTLAB_SUITE="+$suite) -Encoding UTF8
Write-Host ("TestLab suite: "+$suite)
