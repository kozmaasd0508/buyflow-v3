$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$runnerCommit='aa27c2a50abb4f0b3a7cbe216492bdad28d8acf5'
$runnerUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$runnerCommit/scripts/buyflow-real60-h1-prompt-v2.mjs"
$nodePath='C:\Program Files\nodejs\node.exe'
$tempRunner=Join-Path $env:TEMP ('buyflow-real60-h1-prompt-v2-' + [guid]::NewGuid().ToString('N') + '.mjs')
$originalKey=$env:OPENAI_API_KEY

function Fail([string]$m){throw $m}

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW REAL60 H1 - FROZEN PROMPT V2' -ForegroundColor Cyan
  Write-Host '60 fresh blind holdout cases. Luna + Terra + Sol.' -ForegroundColor Green
  Write-Host 'Reference frozen before model calls.' -ForegroundColor Green
  Write-Host 'No Gmail calls. BuyFlow writes 0. Production OFF. O3 NOT USED.' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan

  if(-not (Test-Path -LiteralPath $nodePath)){Fail 'NODE_NOT_FOUND'}

  $bundle=Get-ChildItem (Join-Path $env:USERPROFILE 'Desktop') -Recurse -File -Filter 'real60-h1-blind-bundle-private-local.json' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if(-not $bundle){Fail 'REAL60_H1_BLIND_BUNDLE_NOT_FOUND'}
  Write-Host ('Bundle: '+$bundle.FullName) -ForegroundColor DarkGray

  $outPath=Join-Path $bundle.Directory.FullName 'real60-h1-prompt-v2-results-private-local.json'

  if(-not $env:OPENAI_API_KEY){
    $sec=Read-Host 'OpenAI API key (input hidden)' -AsSecureString
    $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try{$env:OPENAI_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)}
  }
  if([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)){Fail 'OPENAI_API_KEY_MISSING'}

  Invoke-WebRequest -UseBasicParsing -Uri $runnerUrl -OutFile $tempRunner -TimeoutSec 60
  & $nodePath $tempRunner $bundle.FullName $outPath
  if($LASTEXITCODE -ne 0){Fail ('REAL60_H1_PROMPT_V2_EXIT_'+$LASTEXITCODE)}

  Write-Host ''
  Write-Host 'KESZ. Masold be ide a REAL60 H1 RESULT blokkot.' -ForegroundColor Cyan
}
finally {
  if($null -eq $originalKey){Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue}else{$env:OPENAI_API_KEY=$originalKey}
  if(Test-Path -LiteralPath $tempRunner){Remove-Item -LiteralPath $tempRunner -Force -ErrorAction SilentlyContinue}
}
