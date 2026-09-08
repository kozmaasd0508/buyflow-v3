$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$runnerCommit='46114e2bdbdc1e0e18032ce17610ec19e7030754'
$runnerUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$runnerCommit/scripts/buyflow-real100-h3-luna-v32-blind.mjs"
$tempScript=Join-Path $env:TEMP ('buyflow-h3-luna-v32-' + [guid]::NewGuid().ToString('N') + '.mjs')
$originalKey=$env:OPENAI_API_KEY
function Fail([string]$m){throw $m}
try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW REAL100 H3 - BLIND LUNA / PROMPT V3.2' -ForegroundColor Cyan
  Write-Host '89 pre-Luna gold + 11 pre-declared REVIEW cases.' -ForegroundColor Green
  Write-Host 'No Gmail calls. BuyFlow writes 0. Production OFF. O3 NOT USED.' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan
  $node=(Get-Command node -ErrorAction SilentlyContinue)
  if(-not $node){Fail 'NODE_NOT_FOUND'}
  $preferred=Join-Path $env:USERPROFILE 'Desktop\Buyflow minden\buyflow-real100-h3-v1\real100-h3-blind-bundle-maillens-v1.1-private-local.json'
  if(Test-Path -LiteralPath $preferred){$bundle=Get-Item -LiteralPath $preferred}else{$bundle=Get-ChildItem (Join-Path $env:USERPROFILE 'Desktop') -Recurse -File -Filter 'real100-h3-blind-bundle-maillens-v1.1-private-local.json' -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 1}
  if(-not $bundle){Fail 'REAL100_H3_BUNDLE_NOT_FOUND'}
  Write-Host ('Bundle: '+$bundle.FullName) -ForegroundColor DarkGray
  $outPath=Join-Path $bundle.Directory.FullName 'real100-h3-maillens-v1.1-prompt-v32-luna-blind-results.json'
  $secure=Read-Host 'OpenAI API key (input hidden)' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try{$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  if([string]::IsNullOrWhiteSpace($plain)){Fail 'OPENAI_API_KEY_EMPTY'}
  $env:OPENAI_API_KEY=$plain;$plain=$null
  Invoke-WebRequest -UseBasicParsing -Uri $runnerUrl -OutFile $tempScript -TimeoutSec 60
  & $node.Source $tempScript $bundle.FullName $outPath
  $exit=$LASTEXITCODE
  if($exit -ne 0){Fail "H3_LUNA_V32_EXIT_$exit"}
  if(-not(Test-Path -LiteralPath $outPath)){Fail 'H3_LUNA_V32_RESULT_NOT_CREATED'}
  Write-Host ''
  Write-Host 'KESZ. Toltsd fel ezt a fajlt, vagy masold be a konzol SUMMARY-t:' -ForegroundColor Green
  Write-Host ('  '+$outPath) -ForegroundColor Cyan
}
finally{
  if(Test-Path -LiteralPath $tempScript){Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue}
  if($null -eq $originalKey){Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue}else{$env:OPENAI_API_KEY=$originalKey}
}
