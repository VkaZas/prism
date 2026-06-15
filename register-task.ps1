# register-task.ps1 — 注册 Windows 计划任务，每天 19:30 自动发布
#
# 任务名:  nanbanqiu-daily-publish
# 触发:    每天 19:30
# 动作:    powershell -NoProfile -ExecutionPolicy Bypass -File <此目录>\publish.ps1
# 身份:    当前用户（这样能复用已缓存的 Git 凭据；只在用户登录时运行）
#
# 若同名任务已存在，先注销再重新注册（幂等）。
# 运行一次即可；以后每天自动跑。需要再次运行才会刷新定义。

$ErrorActionPreference = 'Stop'

$taskName   = 'nanbanqiu-daily-publish'
$publishPs1 = Join-Path $PSScriptRoot 'publish.ps1'

if (-not (Test-Path -LiteralPath $publishPs1)) {
    throw "找不到 publish.ps1: $publishPs1（请确认本脚本与 publish.ps1 在同一目录）。"
}

# 计划任务运行时的工作目录设为仓库根，保证 git 在正确仓库内执行。
$workDir = $PSScriptRoot

# --- 动作：用 powershell.exe 跑 publish.ps1 ---
$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$publishPs1`"" `
    -WorkingDirectory $workDir

# --- 触发：每天 19:30 ---
$trigger = New-ScheduledTaskTrigger -Daily -At '19:30'

# --- 身份：当前登录用户，最高权限关闭（普通用户即可，便于用缓存凭据） ---
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited

# --- 设置：错过触发时间（如关机）开机后补跑；允许使用电池 ---
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# --- 若已存在则先注销（幂等） ---
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -ne $existing) {
    Write-Host "[register] 已存在同名任务 '$taskName'，先注销旧的..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# --- 注册 ---
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description '每天 19:30 构建并发布「南半球聊财经每日Summary」到 GitHub Pages' | Out-Null

Write-Host ""
Write-Host "[register] 已注册计划任务: $taskName"
Write-Host "           触发时间: 每天 19:30"
Write-Host "           运行身份: $currentUser（仅在该用户登录时运行）"
Write-Host "           执行命令: powershell -NoProfile -ExecutionPolicy Bypass -File `"$publishPs1`""
Write-Host ""
Write-Host "立即测试一次（不必等到 19:30）:"
Write-Host "    Start-ScheduledTask -TaskName '$taskName'"
Write-Host ""
Write-Host "查看运行状态 / 上次结果:"
Write-Host "    Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host ""
Write-Host "如何取消（停止每日自动发布）:"
Write-Host "    Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
Write-Host "  或在『任务计划程序』(taskschd.msc) 里删除任务 '$taskName'。"
Write-Host ""
