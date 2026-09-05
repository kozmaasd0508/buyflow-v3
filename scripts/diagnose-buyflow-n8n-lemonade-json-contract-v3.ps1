$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$rawPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-LEMONADE-JSON-CONTRACT-RAW.txt'
if(-not (Test-Path -LiteralPath $rawPath)){throw ('RAW_NOT_FOUND:'+ $rawPath)}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - LEMONADE JSON CONTRACT DIAGNOSTIC V3' -ForegroundColor Cyan
Write-Host 'Read-only. Re-scores EXISTING RAW only. No AI calls.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

$s=Get-Content -LiteralPath $rawPath -Raw
$s=[regex]::Replace($s,"`e\[[0-9;?]*[ -/]*[@-~]",'')

# Extract balanced JSON objects that follow an "output": marker.
$objs=New-Object System.Collections.Generic.List[object]
$marker='"output"'
$pos=0
while($true){
  $m=$s.IndexOf($marker,$pos,[System.StringComparison]::Ordinal)
  if($m -lt 0){break}
  $colon=$s.IndexOf(':',$m+$marker.Length)
  if($colon -lt 0){break}
  $start=$s.IndexOf('{',$colon+1)
  if($start -lt 0){break}

  $depth=0; $inString=$false; $escape=$false; $end=-1
  for($i=$start;$i -lt $s.Length;$i++){
    $ch=$s[$i]
    if($inString){
      if($escape){$escape=$false; continue}
      if($ch -eq '\\'){$escape=$true; continue}
      if($ch -eq '"'){$inString=$false}
      continue
    }
    if($ch -eq '"'){$inString=$true; continue}
    if($ch -eq '{'){$depth++}
    elseif($ch -eq '}'){
      $depth--
      if($depth -eq 0){$end=$i;break}
    }
  }
  if($end -lt 0){break}
  $jsonText=$s.Substring($start,$end-$start+1)
  try{
    $o=$jsonText | ConvertFrom-Json -ErrorAction Stop
    if($null -ne $o.case_id -and $null -ne $o.event_type -and $null -ne $o.action){$objs.Add($o)}
  }catch{}
  $pos=$end+1
}

# Deduplicate by case_id because n8n RAW may repeat node data in metadata sections.
$byCase=[ordered]@{}
foreach($o in $objs){
  $cid=[string]$o.case_id
  if($cid -match '^C\d\d$' -and -not $byCase.Contains($cid)){$byCase[$cid]=$o}
}

$expected=[ordered]@{
  C01=@('ORDER_CREATED','CREATE')
  C02=@('PAYMENT','LINK')
  C03=@('SHIPMENT_CREATED','LINK')
  C04=@('SHIPPED','LINK')
  C05=@('IN_TRANSIT','LINK')
  C06=@('OUT_FOR_DELIVERY','LINK')
  C07=@('READY_FOR_PICKUP','LINK')
  C08=@('DELIVERED','LINK')
  C09=@('OTHER','IGNORE')
  C10=@('OTHER','IGNORE')
  C11=@('OTHER','IGNORE')
  C12=@('OTHER','IGNORE')
}

$results=@()
foreach($cid in $expected.Keys){
  $errors=@()
  if(-not $byCase.Contains($cid)){
    $results += [pscustomobject]@{case_id=$cid;pass=$false;event_type=$null;action=$null;confidence=$null;reason=$null;errors=@('missing_output_object')}
    continue
  }
  $o=$byCase[$cid]
  if([string]$o.event_type -ne $expected[$cid][0]){$errors += ('event_expected_'+$expected[$cid][0]+'_got_'+[string]$o.event_type)}
  if([string]$o.action -ne $expected[$cid][1]){$errors += ('action_expected_'+$expected[$cid][1]+'_got_'+[string]$o.action)}
  $confOk=$false
  try{$cv=[double]$o.confidence; $confOk=($cv -ge 0 -and $cv -le 1)}catch{}
  if(-not $confOk){$errors += 'invalid_confidence'}
  $reason=[string]$o.reason
  if([string]::IsNullOrWhiteSpace($reason) -or $reason.Length -gt 240){$errors += 'invalid_reason'}
  $results += [pscustomobject]@{case_id=$cid;pass=($errors.Count -eq 0);event_type=[string]$o.event_type;action=[string]$o.action;confidence=$o.confidence;reason=$reason;errors=$errors}
}

$passed=@($results | Where-Object {$_.pass}).Count
$failed=12-$passed
Write-Host ('Extracted unique case outputs: '+$byCase.Count) -ForegroundColor Cyan
Write-Host ('Passed: '+$passed+' / 12') -ForegroundColor $(if($passed -eq 12){'Green'}else{'Yellow'})
Write-Host ('Failed: '+$failed) -ForegroundColor $(if($failed -eq 0){'Green'}else{'Red'})
Write-Host ''
foreach($r in $results){
  if($r.pass){
    Write-Host ($r.case_id+' PASS  '+$r.event_type+' / '+$r.action+'  confidence='+$r.confidence) -ForegroundColor Green
  }else{
    Write-Host ($r.case_id+' FAIL  '+$r.event_type+' / '+$r.action+'  '+($r.errors -join '; ')) -ForegroundColor Red
  }
}
Write-Host ''
if($passed -eq 12){
  Write-Host 'EXISTING RAW CONTRACT SCORE: PASS (12/12)' -ForegroundColor Green
}else{
  Write-Host ('EXISTING RAW CONTRACT SCORE: '+$passed+'/12') -ForegroundColor Yellow
}
Write-Host 'No AI calls | no n8n changes | no BuyFlow writes' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan
