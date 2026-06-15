# 南半球聊财经每日Summary — 站点

把 `daily_summaries/jason_解读_YYYY-MM-DD.md` 系列文档，每天自动构建成一个 Medium 风格的公开博客，发布到 **GitHub Pages**。

- 构建：自写 Node 脚本（`build.mjs` + `markdown-it`），无框架。
- 托管：GitHub Pages，main 分支的 `/docs` 文件夹，完全公开。
- 自动化：Windows 计划任务每天 **19:30** 构建并 push。

> 源 markdown 在 `..\daily_summaries\`（仓库外），不会被提交；只发布 `docs/` 下的精简产物。

---

## 一、一次性设置

按顺序做一遍，以后就全自动了。除非特别说明，命令都在本目录（`jason_site\`）的 PowerShell 里运行。

### 1. 安装依赖

```powershell
npm install
```

### 2. 设置站点 URL（`SITE_URL`）

`SITE_URL` 只用于 `feed.xml` 和 `og:` / canonical 的**绝对**链接。建议仓库名用 `nanbanqiu-daily`，则站点地址是
`https://<你的 GitHub 用户名>.github.io/nanbanqiu-daily/`。

把 `<你的GitHub用户名>` 换成你自己的，**持久化**到用户环境变量（一次即可，新开的终端都会有）：

```powershell
[Environment]::SetEnvironmentVariable('SITE_URL', 'https://<你的GitHub用户名>.github.io/nanbanqiu-daily', 'User')
# 让当前这个终端也立即生效（新终端自动带上）：
$env:SITE_URL = 'https://<你的GitHub用户名>.github.io/nanbanqiu-daily'
```

> 不设也能构建，`build.mjs` 会回退到占位 URL，但 RSS / 分享链接会不对。建议设好。

### 3. 先本地构建一次，确认无误

```powershell
node build.mjs
```

应在 `docs\` 下生成 `index.html`、若干 `<日期>.html`、`assets\<日期>\` 图片、`feed.xml`。
可双击 `docs\index.html` 在浏览器里预览。

### 4. 初始化 Git 仓库并推到 GitHub（公开）

这一步会创建一个**外部可见的公开仓库**。两种方式，任选其一。

#### 方式 A（推荐）：用 GitHub CLI `gh` 一条命令搞定

前提：已装 [`gh`](https://cli.github.com/) 并登录过（`gh auth login`，按提示用浏览器授权一次）。

```powershell
git init
git add -A
git commit -m "init: 南半球聊财经每日Summary 站点"
gh repo create nanbanqiu-daily --public --source . --remote origin --push
```

`gh repo create` 会建好公开仓库、加好 `origin` 远端、并把当前分支推上去。

> 若默认分支不是 `main`，先 `git branch -M main` 再推。

#### 方式 B（手动）：自己在网站建仓 + 关联远端

1. 浏览器打开 <https://github.com/new>，仓库名填 `nanbanqiu-daily`，选 **Public**，**不要**勾选 "Add a README / .gitignore / license"（保持空仓）。
2. 回到本目录：

```powershell
git init
git branch -M main
git add -A
git commit -m "init: 南半球聊财经每日Summary 站点"
git remote add origin https://github.com/<你的GitHub用户名>/nanbanqiu-daily.git
git push -u origin main
```

3. 首次 `git push` 会弹出 GitHub 登录 / 浏览器授权，**授权一次**即可——之后凭据被 Windows 的 Git Credential Manager 缓存，计划任务无人值守也能 push。

### 5. 在 GitHub 仓库里开启 Pages

1. 打开仓库 → **Settings** → 左侧 **Pages**。
2. **Source** 选 **Deploy from a branch**。
3. **Branch** 选 `main`，文件夹选 **`/docs`**，点 **Save**。
4. 等约 1 分钟，页面顶部会显示站点地址：
   `https://<你的GitHub用户名>.github.io/nanbanqiu-daily/`
   （应与第 2 步设的 `SITE_URL` 一致。）

### 6. 开启每日自动发布（注册计划任务）

```powershell
./register-task.ps1
```

它会注册计划任务 **`nanbanqiu-daily-publish`**，每天 **19:30** 以你的用户身份运行 `publish.ps1`（构建 → 提交 → 推送）。脚本结尾会打印如何立即测试、如何查状态、如何取消。

> 计划任务只在**你登录 Windows 时**运行（用普通用户身份，以便复用缓存的 git 凭据）。

---

## 二、日常使用

### 手动发布一次

```powershell
./publish.ps1
```

等价于：`node build.mjs` → `git add -A` → 有变更则 `git commit -m "publish: <今天日期>"` + `git push`，无变更则打印「无变更」。**构建失败不会 push。**

### 立即跑一次计划任务（不等 19:30）

```powershell
Start-ScheduledTask -TaskName 'nanbanqiu-daily-publish'
```

### 查看计划任务上次运行结果

```powershell
Get-ScheduledTask -TaskName 'nanbanqiu-daily-publish' | Get-ScheduledTaskInfo
```

`LastTaskResult` 为 `0` 表示成功。

### 取消每日自动发布

```powershell
Unregister-ScheduledTask -TaskName 'nanbanqiu-daily-publish' -Confirm:$false
```

或在『任务计划程序』(`taskschd.msc`) 里删除任务 `nanbanqiu-daily-publish`。删除任务不影响仓库与已发布的站点。

---

## 三、常见故障排查

| 症状 | 原因 / 处理 |
|---|---|
| `./publish.ps1` 报「无法加载，因为在此系统上禁止运行脚本」 | 执行策略限制。用 `powershell -ExecutionPolicy Bypass -File .\publish.ps1` 运行；计划任务已自带 `-ExecutionPolicy Bypass`，不受影响。 |
| `node` / `npm` / `git` 「不是内部或外部命令」 | 未装或不在 PATH。装好 Node（含 npm）和 Git，**新开**终端再试（PATH 改动需重开终端）。 |
| `gh` 未找到 / 未登录 | 走 README「方式 B」手动建仓；或先 `gh auth login` 再用方式 A。 |
| `git push` 反复要账号密码 / 推送被拒 | 凭据未缓存或失效。手动 `git push` 一次，按浏览器提示重新授权（Git Credential Manager 会缓存）；确认远端用 HTTPS：`git remote -v`。 |
| 计划任务 `LastTaskResult` 非 0（如 `0x1`） | 多为构建报错或 git 推送失败。手动 `./publish.ps1` 看完整报错；常见是网络 / 凭据。计划任务**仅在你登录时**运行，注销 / 锁屏睡眠期间不跑。 |
| 站点 404 / 不更新 | 确认 Settings→Pages 选的是 `main` + `/docs`；`docs/` 已被提交（`.gitignore` **不**忽略它）；Pages 部署有 ~1 分钟延迟，可在仓库 **Actions** 标签看 "pages build and deployment" 状态。 |
| RSS / 分享链接域名不对 | `SITE_URL` 没设或设错。按第 2 步重设，再 `node build.mjs` 重新构建并发布。 |
| 改了 `SITE_URL` 但产物没变 | `SITE_URL` 在**构建时**读取。重设后必须重新跑 `node build.mjs`（或 `./publish.ps1`）。 |
| 推上去的体积很大 | 源 md 里的图片是内联 base64，`build.mjs` 会抽成 `docs/assets/` 下的文件。确认提交的是 `docs/` 产物，且没把仓库外的源 md 拷进来。 |

---

## 四、目录结构

```
jason_site\                  ← 本目录 = 一个 git 仓库 → GitHub
├── package.json             # type:module；devDep: markdown-it；script: build
├── build.mjs                # 构建器：源 md → 静态站点（输出到 docs/）
├── src/
│   ├── styles.css           # 设计系统（构建时复制到 docs/styles.css）
│   └── app.js               # 客户端交互（复制到 docs/app.js）
├── docs/                    # 构建输出 = GitHub Pages 根（必须提交）
│   ├── index.html
│   ├── <YYYY-MM-DD>.html
│   ├── assets/<date>/imgN.png|jpg
│   └── feed.xml
├── publish.ps1             # 构建 + git add/commit/push（幂等）
├── register-task.ps1       # 注册 / 刷新每日 19:30 计划任务
├── .gitignore             # 忽略 node_modules 等；不忽略 docs/
└── README.md              # 本文件
```
