$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $repoRoot 'BuyFlow-AI.vbs'
if (-not (Test-Path $launcher)) { throw "Nem talalom a BuyFlow AI inditot: $launcher" }

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'BuyFlow AI.lnk'

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = 'BuyFlow AI - Tanari Chat'
$shortcut.WindowStyle = 7
$shortcut.Save()

Write-Host "KESZ: $shortcutPath" -ForegroundColor Green
