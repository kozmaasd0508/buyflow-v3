$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $repoRoot 'BuyFlow-AI.cmd'
if (-not (Test-Path $launcher)) { throw "Nem talalom a BuyFlow AI inditot: $launcher" }

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'BuyFlow AI.lnk'

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = 'BuyFlow AI - Tanari Chat'
$shortcut.WindowStyle = 7
$shortcut.Save()

Write-Host "KESZ: $shortcutPath" -ForegroundColor Green
