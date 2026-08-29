Option Explicit

Dim shell, fso, repoRoot, psScript, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

repoRoot = fso.GetParentFolderName(WScript.ScriptFullName)
psScript = fso.BuildPath(repoRoot, "scripts\start-v9-teacher-chat.ps1")

If Not fso.FileExists(psScript) Then
  MsgBox "Nem talalom a BuyFlow AI indito scriptet:" & vbCrLf & psScript, vbCritical, "BuyFlow AI"
  WScript.Quit 1
End If

command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & psScript & """"
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode
