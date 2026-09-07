$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$runnerCommit='f53679cd1411906ec24e9375e89f2787a0d0a093'
$runnerUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$runnerCommit/scripts/buyflow-real120-disagreement35-prompt-v2.mjs"
$nodePath='C:\Program Files\nodejs\node.exe'
$tempRunner=Join-Path $env:TEMP ('buyflow-real120-prompt-v2-' + [guid]::NewGuid().ToString('N') + '.mjs')
$originalKey=$env:OPENAI_API_KEY

function Fail([string]$m){throw $m}

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW REAL120 DISAGREEMENT35 - PROMPT V2' -ForegroundColor Cyan
  Write-Host '35 measured disagreement cases. Existing MailLens bundle only.' -ForegroundColor Green
  Write-Host 'Luna + Terra + Sol all 35. No Gmail calls. BuyFlow writes 0.' -ForegroundColor Green
  Write-Host 'Production OFF. Blind O3 NOT USED.' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan

  if(-not (Test-Path -LiteralPath $nodePath)){Fail 'NODE_NOT_FOUND'}

  $bundle=Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE 'Desktop') -Directory -Filter 'buyflow-real120-mail-lens-openai-*' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    ForEach-Object { Join-Path $_.FullName 'blind-adjudication-bundle-private-local.json' } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
  if(-not $bundle){Fail 'BLIND_ADJUDICATION_BUNDLE_NOT_FOUND'}

  Write-Host ('Bundle: '+$bundle) -ForegroundColor DarkGray
  $outPath=Join-Path (Split-Path -Parent $bundle) 'prompt-v2-results-private-local.json'

  if(-not $env:OPENAI_API_KEY){
    $sec=Read-Host 'OpenAI API key (input hidden)' -AsSecureString
    $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try{$env:OPENAI_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)}
  }
  if([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)){Fail 'OPENAI_API_KEY_MISSING'}

  Invoke-WebRequest -UseBasicParsing -Uri $runnerUrl -OutFile $tempRunner -TimeoutSec 60
  & $nodePath $tempRunner $bundle $outPath
  if($LASTEXITCODE -ne 0){Fail ('PROMPT_V2_EXIT_'+$LASTEXITCODE)}

  Write-Host ''
  Write-Host 'KESZ. Masold be ide a PROMPT V2 RESULT blokkot.' -ForegroundColor Cyan
}
finally {
  if($null -eq $originalKey){Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue}else{$env:OPENAI_API_KEY=$originalKey}
  if(Test-Path -LiteralPath $tempRunner){Remove-Item -LiteralPath $tempRunner -Force -ErrorAction SilentlyContinue}
}
