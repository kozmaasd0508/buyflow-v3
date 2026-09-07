$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$sourceCommit='3eb439fa2ef27cbf7f8307eab32d1d4dd9c5f0a0'
$sourceUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$sourceCommit/scripts/run-buyflow-real60-h1-blind.ps1"
$temp=Join-Path $env:TEMP ('run-buyflow-real60-h1-blind-fixed-' + [guid]::NewGuid().ToString('N') + '.ps1')

try {
  Invoke-WebRequest -UseBasicParsing -Uri $sourceUrl -OutFile $temp -TimeoutSec 60
  $text=Get-Content -Raw -LiteralPath $temp

  # The V1 repo locator incorrectly required node_modules at the repository root.
  # Earlier BuyFlow runners successfully use repositories where apps/api is valid
  # even when root/node_modules is absent. Remove only that extra locator condition.
  $old="(Test-Path -LiteralPath (Join-Path `$p 'apps\\api\\src\\email\\normalize-document-v1.ts')) -and`r`n         (Test-Path -LiteralPath (Join-Path `$p 'node_modules'))"
  $new="(Test-Path -LiteralPath (Join-Path `$p 'apps\\api\\src\\email\\normalize-document-v1.ts'))"
  if(-not $text.Contains($old)){
    $old="(Test-Path -LiteralPath (Join-Path `$p 'apps\\api\\src\\email\\normalize-document-v1.ts')) -and`n         (Test-Path -LiteralPath (Join-Path `$p 'node_modules'))"
  }
  if(-not $text.Contains($old)){ throw 'V1_REPO_LOCATOR_PATTERN_NOT_FOUND' }
  $text=$text.Replace($old,$new)
  Set-Content -LiteralPath $temp -Value $text -Encoding UTF8

  powershell.exe -NoProfile -ExecutionPolicy Bypass -File $temp
  if($LASTEXITCODE -ne 0){ throw ('REAL60_H1_V2_EXIT_'+$LASTEXITCODE) }
}
finally {
  if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue}
}
