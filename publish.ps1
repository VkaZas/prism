# publish.ps1 — 构建并发布「南半球聊财经每日Summary」到 GitHub Pages
#
# 流程：
#   1. 切到脚本所在目录（仓库根）
#   2. node build.mjs  构建静态站点到 docs/（构建失败则停止，不 push）
#   3. git add -A
#   4. 若有变更则 git commit + git push；否则打印「无变更」
#
# 由 register-task.ps1 注册的计划任务每天 19:30 调用此脚本。
# 也可手动运行：  ./publish.ps1

$ErrorActionPreference = 'Stop'

# 让所有 native 命令（node/git）的非零退出码都被视为失败抛出。
# PowerShell 7+ 支持；老版本忽略。
try { $PSNativeCommandUseErrorActionPreference = $true } catch {}

# --- 1. 切到脚本所在目录（与 cwd 无关，计划任务调用时也正确） ---
Set-Location -LiteralPath $PSScriptRoot
Write-Host "[publish] 工作目录: $PSScriptRoot"

# --- 2. 构建 ---
Write-Host "[publish] 开始构建: node build.mjs"
node build.mjs
if ($LASTEXITCODE -ne 0) {
    throw "构建失败 (node build.mjs 退出码 $LASTEXITCODE)，已停止，不会 push。"
}
Write-Host "[publish] 构建成功。"

# --- 3. 暂存全部变更 ---
git add -A
if ($LASTEXITCODE -ne 0) { throw "git add -A 失败 (退出码 $LASTEXITCODE)。" }

# --- 4. 有变更才提交并推送 ---
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "[publish] 无变更，跳过 commit / push。"
}
else {
    $date = Get-Date -Format 'yyyy-MM-dd'
    $message = "publish: $date"
    Write-Host "[publish] 检测到变更，提交: $message"

    git commit -m $message
    if ($LASTEXITCODE -ne 0) { throw "git commit 失败 (退出码 $LASTEXITCODE)。" }

    Write-Host "[publish] 推送到远端..."
    git push
    if ($LASTEXITCODE -ne 0) { throw "git push 失败 (退出码 $LASTEXITCODE)。检查网络与 Git 凭据（见 README 故障排查）。" }

    Write-Host "[publish] 已推送。GitHub Pages 将在约 1 分钟内更新。"
}

Write-Host "[publish] 完成。"
