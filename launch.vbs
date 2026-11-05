Option Explicit
Dim shell, fso, appDir, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
command = "cmd.exe /c """ & appDir & "\start.bat"""
shell.Run command, 0, False
