param(
  [Parameter(Mandatory = $true)][string]$ReportPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ReportPath)) {
  throw "Nem talalom a V9 identity reportot: $ReportPath"
}

$report = Get-Content -Raw -Path $ReportPath | ConvertFrom-Json
$cases = @($report.cases)

Write-Host ""
Write-Host '===== V9 IDENTITY DIAGNOSTICS =====' -ForegroundColor Cyan

$reasonCounts = @{}
foreach ($case in $cases) {
  foreach ($reason in @($case.creationReasons)) {
    if (-not $reasonCounts.ContainsKey($reason)) { $reasonCounts[$reason] = 0 }
    $reasonCounts[$reason]++
  }
}

Write-Host 'creation_reason_counts:' -ForegroundColor Yellow
if ($reasonCounts.Count -eq 0) {
  Write-Host '  (none)'
} else {
  foreach ($entry in $reasonCounts.GetEnumerator() | Sort-Object Name) {
    Write-Host ("  {0}: {1}" -f $entry.Name, $entry.Value)
  }
}

Write-Host ""
Write-Host 'non-linked cases:' -ForegroundColor Yellow
foreach ($case in $cases | Where-Object { $_.decision -notin @('NEW_PURCHASE','LINKED') }) {
  $reasons = if (@($case.creationReasons).Count -gt 0) { (@($case.creationReasons) -join ',') } else { '-' }
  $hard = if (@($case.hardEvidenceTypes).Count -gt 0) { (@($case.hardEvidenceTypes) -join ',') } else { '-' }
  Write-Host (
    "  chain={0} seq={1} target={2} model={3} role={4} authority={5} decision={6} reasons=[{7}] hard=[{8}] aliases(order={9},track={10},invoice={11},payment={12})" -f \
      $case.chain, $case.sequence, $case.targetEventType, $case.modelEventType, $case.sourceRole, \
      $case.creationAuthority, $case.decision, $reasons, $hard, \
      $case.orderAliasCount, $case.trackingAliasCount, $case.invoiceAliasCount, $case.paymentAliasCount
  )
}

Write-Host ""
Write-Host 'linked/created cases:' -ForegroundColor Yellow
foreach ($case in $cases | Where-Object { $_.decision -in @('NEW_PURCHASE','LINKED') }) {
  $hard = if (@($case.hardEvidenceTypes).Count -gt 0) { (@($case.hardEvidenceTypes) -join ',') } else { '-' }
  Write-Host (
    "  chain={0} seq={1} target={2} model={3} role={4} authority={5} decision={6} hard=[{7}]" -f \
      $case.chain, $case.sequence, $case.targetEventType, $case.modelEventType, $case.sourceRole, \
      $case.creationAuthority, $case.decision, $hard
  )
}

Write-Host '===== END V9 IDENTITY DIAGNOSTICS =====' -ForegroundColor Cyan
