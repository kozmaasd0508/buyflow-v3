$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$pinnedCommit='d118699815aff5f8720d9afe15ba4e1e07bb17dc'
$mailLensCommit='a10c6a61036e91e91dfbad3eaa998e81f6239401'
$policyCommit='bc046c361a9269e891456bc0b8e7105c701cf59e'
$promptCommit='25810f66af0855fbc81d913872072d42d75a0abb'
$expectedNormalizer='normalized-email-document-v1.2'
$expectedH3Sha='59650c8dbb687be609361b3e3576a404f9acdba5ea13f71985dcd0dc2451b04f'
$real120Ids=Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json'
$nodePath='C:\Program Files\nodejs\node.exe'
$n8nScript=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime\node_modules\n8n\bin\n8n'
$n8nUserFolder=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
$credentialId='FqG6EUXZPfOERjkV'
$tempRoot=Join-Path $env:TEMP ('buyflow-real100-h4-' + [guid]::NewGuid().ToString('N'))
$worktree=Join-Path $tempRoot 'worktree'
$credentialPath=Join-Path $tempRoot 'credential.json'
$repoRoot=$null;$createdWorktree=$false;$originalN8nUserFolder=$env:N8N_USER_FOLDER

function Fail([string]$m){throw $m}
function As-Array($v){if($null -eq $v){return @()};if($v -is [System.Array]){return @($v)};return @($v)}
function Get-PropertyValue($o,[string[]]$names){if($null -eq $o){return $null};foreach($name in $names){$p=$o.PSObject.Properties[$name];if($null -ne $p -and $null -ne $p.Value){if($p.Value -isnot [string] -or -not [string]::IsNullOrWhiteSpace([string]$p.Value)){return $p.Value}}};return $null}
function Parse-TokenData($data){$t=Get-PropertyValue $data @('oauthTokenData','oauth_token_data','tokenData','token_data');if(-not $t){return $null};if($t -is [string]){try{return ($t|ConvertFrom-Json)}catch{return $null}};return $t}
function Is-BuyFlowGitRepo([string]$p){if(-not(Test-Path -LiteralPath (Join-Path $p 'apps\api\package.json'))){return $false};if(-not(Test-Path -LiteralPath (Join-Path $p '.git'))){return $false};try{$origin=(& git -C $p config --get remote.origin.url 2>$null|Select-Object -First 1);return([string]$origin -match 'buyflow-v3')}catch{return $false}}
function Find-BuyFlowRepo{$desktop=Join-Path $env:USERPROFILE 'Desktop';$known=@((Join-Path $desktop 'buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'),(Join-Path $desktop 'buyflow\buyflow-v3'),(Join-Path $desktop 'buyflow\.n8n-local-ai-runner\buyflow-v3'),(Join-Path $desktop 'buyflow\V11_INPUT_VIEW_HOLDOUT_V2'));foreach($p in $known){if(Is-BuyFlowGitRepo $p){return $p}};$roots=@((Join-Path $desktop 'buyflow'),(Join-Path $desktop 'Buyflow minden'))|Where-Object{Test-Path -LiteralPath $_};foreach($root in $roots){$c=Get-ChildItem -LiteralPath $root -Directory -Recurse -Force -ErrorAction SilentlyContinue|Where-Object{Is-BuyFlowGitRepo $_.FullName}|Select-Object -First 1;if($c){return $c.FullName}};return $null}
function Link-NodeModules([string]$source,[string]$target){if(-not(Test-Path -LiteralPath $source)){return $false};$parent=Split-Path -Parent $target;New-Item -ItemType Directory -Force -Path $parent|Out-Null;if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force};New-Item -ItemType Junction -Path $target -Target $source|Out-Null;return $true}
function Find-Latest([string]$name){$roots=@((Join-Path $env:USERPROFILE 'Desktop'),(Join-Path $env:USERPROFILE 'Documents'),(Join-Path $env:USERPROFILE 'Downloads'))|Where-Object{Test-Path -LiteralPath $_};$all=@();foreach($r in $roots){$all+=Get-ChildItem -LiteralPath $r -Recurse -File -Filter $name -ErrorAction SilentlyContinue};return $all|Sort-Object LastWriteTime -Descending|Select-Object -First 1}

New-Item -ItemType Directory -Force -Path $tempRoot|Out-Null
try{
 Write-Host ''
 Write-Host '==============================================================' -ForegroundColor Cyan
 Write-Host 'BUYFLOW REAL100 H4 - FRESH BLIND / MAILLENS v1.2' -ForegroundColor Cyan
 Write-Host 'Local AI vs Luna clean re-check: INPUT FREEZE ONLY.' -ForegroundColor Green
 Write-Host 'NO model calls. Gmail GET only. Production OFF. O3 NOT USED.' -ForegroundColor Green
 Write-Host '==============================================================' -ForegroundColor Cyan
 if(-not(Get-Command git -ErrorAction SilentlyContinue)){Fail 'GIT_NOT_FOUND'}
 if(-not(Test-Path -LiteralPath $nodePath)){Fail 'NODE_NOT_FOUND'}
 if(-not(Test-Path -LiteralPath $n8nScript)){Fail 'N8N_RUNTIME_NOT_FOUND'}
 if(-not(Test-Path -LiteralPath $real120Ids)){Fail "REAL120_IDS_NOT_FOUND:$real120Ids"}
 $h1Ids=Find-Latest 'real60-h1-ids-private-local.json';if(-not $h1Ids){Fail 'H1_IDS_NOT_FOUND'}
 $h2Ids=Find-Latest 'real100-h2-ids-private-local.json';if(-not $h2Ids){Fail 'H2_IDS_NOT_FOUND'}
 $h3Ids=Find-Latest 'real100-h3-ids-private-local.json';if(-not $h3Ids){Fail 'H3_IDS_NOT_FOUND'}
 $h3Doc=Get-Content -Raw -LiteralPath $h3Ids.FullName|ConvertFrom-Json
 if($h3Doc.selection_sha256 -ne $expectedH3Sha -or $h3Doc.ids.Count -ne 100 -or $h3Doc.thread_ids.Count -ne 100){Fail 'H3_IDS_CHECKPOINT_INVALID'}
 Write-Host ('H1 IDs: '+$h1Ids.FullName) -ForegroundColor DarkGray
 Write-Host ('H2 IDs: '+$h2Ids.FullName) -ForegroundColor DarkGray
 Write-Host ('H3 IDs: '+$h3Ids.FullName) -ForegroundColor DarkGray

 $repoRoot=Find-BuyFlowRepo;if(-not $repoRoot){Fail 'BUYFLOW_GIT_REPO_NOT_FOUND'}
 Write-Host ('Base repo: '+$repoRoot) -ForegroundColor DarkGray
 $preferredBase=Join-Path $env:USERPROFILE 'Desktop\Buyflow minden';if(-not(Test-Path -LiteralPath $preferredBase)){$preferredBase=Join-Path $env:USERPROFILE 'Desktop'}
 $outDir=Join-Path $preferredBase 'buyflow-real100-h4-v1';New-Item -ItemType Directory -Force -Path $outDir|Out-Null

 Write-Host '[1/7] Fetch pinned H4 code...' -ForegroundColor Yellow
 & git -C $repoRoot fetch origin $pinnedCommit --depth=1 --quiet
 if($LASTEXITCODE -ne 0){Fail 'GIT_FETCH_PINNED_H4_FAILED'}
 Write-Host '[2/7] Create isolated worktree...' -ForegroundColor Yellow
 & git -C $repoRoot worktree add --detach $worktree $pinnedCommit|Out-Null
 if($LASTEXITCODE -ne 0){Fail 'GIT_WORKTREE_ADD_FAILED'};$createdWorktree=$true

 $normalizerPath=Join-Path $worktree 'apps\api\src\email\normalize-document-v1.ts'
 $normalizerTestPath=Join-Path $worktree 'apps\api\src\email\normalize-document-v1.test.ts'
 $generatorPath=Join-Path $worktree 'apps\api\src\scripts\buyflow-real100-h4-blind-maillens-v12.ts'
 $promptPath=Join-Path $worktree 'scripts\buyflow-email-prompt-v3.4.txt'
 if(-not(Test-Path -LiteralPath $normalizerPath) -or -not(Test-Path -LiteralPath $normalizerTestPath) -or -not(Test-Path -LiteralPath $generatorPath) -or -not(Test-Path -LiteralPath $promptPath)){Fail 'PINNED_H4_FILES_MISSING'}
 $normalizerText=[System.IO.File]::ReadAllText($normalizerPath,[System.Text.Encoding]::UTF8)
 if($normalizerText -notmatch [regex]::Escape($expectedNormalizer)){Fail 'MAIL_LENS_V12_VERSION_GUARD_FAILED'}
 $promptText=[System.IO.File]::ReadAllText($promptPath,[System.Text.Encoding]::UTF8)
 if($promptText -match 'H[1-4]-\d{3}'){Fail 'PROMPT_CASE_ID_LEAK'}
 if($promptText -notmatch 'DELAYED' -or $promptText -notmatch 'merchant-outbound pickup/collection'){Fail 'PROMPT_V34_GUARD_FAILED'}

 Write-Host '[3/7] Prepare dependencies...' -ForegroundColor Yellow
 $linked=$false
 if(Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules')){$linked=Link-NodeModules (Join-Path $repoRoot 'node_modules') (Join-Path $worktree 'node_modules')}
 if(Test-Path -LiteralPath (Join-Path $repoRoot 'apps\api\node_modules')){$null=Link-NodeModules (Join-Path $repoRoot 'apps\api\node_modules') (Join-Path $worktree 'apps\api\node_modules');$linked=$true}
 if(-not $linked){Push-Location $worktree;try{& npm.cmd install --ignore-scripts --no-audit --no-fund}finally{Pop-Location};if($LASTEXITCODE -ne 0){Fail 'NPM_INSTALL_FAILED'}}

 Write-Host '[4/7] Verify MailLens v1.2 deterministically...' -ForegroundColor Yellow
 Push-Location (Join-Path $worktree 'apps\api')
 try{
   & npm.cmd run typecheck
   if($LASTEXITCODE -ne 0){Fail 'MAIL_LENS_V12_TYPECHECK_FAILED'}
   & $nodePath --import tsx --test src/email/normalize-document-v1.test.ts
   if($LASTEXITCODE -ne 0){Fail 'MAIL_LENS_V12_TARGETED_TEST_FAILED'}
 }finally{Pop-Location}

 Write-Host '[5/7] Gmail OAuth token...' -ForegroundColor Yellow
 $env:N8N_USER_FOLDER=$n8nUserFolder
 $o=& $nodePath $n8nScript export:credentials "--id=$credentialId" --decrypted "--output=$credentialPath" 2>&1
 if($LASTEXITCODE -ne 0){Fail ('N8N_CREDENTIAL_EXPORT_FAILED: '+($o -join "`n"))}
 $credential=(As-Array (([System.IO.File]::ReadAllText($credentialPath,[System.Text.Encoding]::UTF8)|ConvertFrom-Json))|Select-Object -First 1)
 $data=Get-PropertyValue $credential @('data');if($null -eq $data){Fail 'GMAIL_CREDENTIAL_DATA_MISSING'}
 $clientId=[string](Get-PropertyValue $data @('clientId','client_id'));$clientSecret=[string](Get-PropertyValue $data @('clientSecret','client_secret'));$refreshToken=[string](Get-PropertyValue $data @('refreshToken','refresh_token'))
 $parsed=Parse-TokenData $data;if(-not $refreshToken -and $parsed){$refreshToken=[string](Get-PropertyValue $parsed @('refresh_token','refreshToken'))}
 if(-not $clientId -or -not $clientSecret -or -not $refreshToken){Fail 'GMAIL_OAUTH_DATA_INCOMPLETE'}
 $tokenResponse=Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{client_id=$clientId;client_secret=$clientSecret;refresh_token=$refreshToken;grant_type='refresh_token'} -TimeoutSec 30
 $accessToken=[string](Get-PropertyValue $tokenResponse @('access_token'));if([string]::IsNullOrWhiteSpace($accessToken)){Fail 'GMAIL_ACCESS_TOKEN_MISSING'}
 $env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN=$accessToken

 Write-Host '[6/7] Freeze/resume 100 unseen H4 emails...' -ForegroundColor Yellow
 Push-Location (Join-Path $worktree 'apps\api')
 try{& npm.cmd exec -- tsx $generatorPath $real120Ids $h1Ids.FullName $h2Ids.FullName $h3Ids.FullName $outDir;$exit=$LASTEXITCODE}finally{Pop-Location}
 if($exit -ne 0){Write-Host 'H4 partial progress kept locally. Run SAME command again to resume.' -ForegroundColor Yellow;Fail "REAL100_H4_EXIT_$exit"}

 Write-Host '[7/7] Deterministic evidence receipt...' -ForegroundColor Yellow
 $bundle=Join-Path $outDir 'real100-h4-blind-bundle-maillens-v1.2-private-local.json'
 $summary=Join-Path $outDir 'real100-h4-summary.json'
 $idsPath=Join-Path $outDir 'real100-h4-ids-private-local.json'
 if(-not(Test-Path -LiteralPath $bundle) -or -not(Test-Path -LiteralPath $summary) -or -not(Test-Path -LiteralPath $idsPath)){Fail 'H4_OUTPUT_MISSING'}
 $b=Get-Content -Raw -LiteralPath $bundle|ConvertFrom-Json
 $s=Get-Content -Raw -LiteralPath $summary|ConvertFrom-Json
 $h4=Get-Content -Raw -LiteralPath $idsPath|ConvertFrom-Json
 $priorIds=@()
 foreach($p in @($real120Ids,$h1Ids.FullName,$h2Ids.FullName,$h3Ids.FullName)){$d=Get-Content -Raw -LiteralPath $p|ConvertFrom-Json;if($d -is [System.Array]){$priorIds+=@($d)}else{$priorIds+=@($d.ids)}}
 $priorSet=@{};foreach($id in $priorIds){if($id){$priorSet[[string]$id]=$true}}
 $overlap=0;foreach($id in $h4.ids){if($priorSet.ContainsKey([string]$id)){$overlap++}}
 $receiptPass=($b.benchmark -eq 'buyflow-real100-h4-blind-maillens-v1.2' -and $b.total -eq 100 -and $b.gold_labels_included -eq $false -and $b.mail_lens_normalizer -eq $expectedNormalizer -and $b.mail_lens_pinned_commit -eq $mailLensCommit -and $b.policy_v34_frozen_commit -eq $policyCommit -and $b.prompt_v34_frozen_commit -eq $promptCommit -and $s.selected_count -eq 100 -and $s.model_calls -eq 0 -and $s.buyflow_writes -eq 0 -and $s.production_off -eq $true -and $s.blind_o3_used -eq $false -and $s.local_ai_used -eq $false -and $s.luna_used -eq $false -and $overlap -eq 0)
 $receipt=[ordered]@{
   evidence_receipt=$(if($receiptPass){'PASS'}else{'FAIL'})
   benchmark=$b.benchmark
   selected=$b.total
   selection_sha256=$b.selection_sha256
   mail_lens_normalizer=$b.mail_lens_normalizer
   mail_lens_commit=$mailLensCommit
   policy_v34_commit=$policyCommit
   prompt_v34_commit=$promptCommit
   previous_id_overlap=$overlap
   provider_body_text_html_recovered_count=$s.input_audit.provider_body_text_html_recovered_count
   generic_html_fallback_only_count=$s.input_audit.generic_html_fallback_only_count
   semantic_text_truncated_count=$s.input_audit.semantic_text_truncated_count
   model_calls=$s.model_calls
   gmail_methods=$s.gmail_http_methods
   buyflow_writes=$s.buyflow_writes
   production_off=$s.production_off
   o3_used=$s.blind_o3_used
   local_ai_used=$s.local_ai_used
   luna_used=$s.luna_used
   bundle=$bundle
   summary=$summary
   private_ids=$idsPath
 }
 Write-Host ''
 Write-Host '================ H4 EVIDENCE RECEIPT ================' -ForegroundColor Cyan
 $receipt|ConvertTo-Json -Depth 5
 Write-Host '=====================================================' -ForegroundColor Cyan
 if(-not $receiptPass){Fail 'H4_EVIDENCE_RECEIPT_FAILED'}
 Write-Host 'H4 INPUT FROZEN. DO NOT RUN LOCAL AI OR LUNA YET.' -ForegroundColor Green
 Write-Host 'Upload bundle + summary here first so gold/review can be frozen before either model.' -ForegroundColor Cyan
}finally{
 Remove-Item Env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
 if(Test-Path -LiteralPath $credentialPath){try{Clear-Content -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue}catch{}}
 if($createdWorktree -and $repoRoot){try{& git -C $repoRoot worktree remove --force $worktree 2>$null|Out-Null}catch{}}
 if(Test-Path -LiteralPath $tempRoot){Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue}
 if($null -eq $originalN8nUserFolder){Remove-Item Env:N8N_USER_FOLDER -ErrorAction SilentlyContinue}else{$env:N8N_USER_FOLDER=$originalN8nUserFolder}
}
