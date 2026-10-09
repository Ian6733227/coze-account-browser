# 扣子账号浏览器

在一个窗口里切换多个扣子账号的 macOS 桌面工具。每个账号使用独立的本机网页登录资料，支持五个以上账号、头像与昵称同步、图标侧栏，以及供其他软件调用的本机 CLI。

**非扣子官方产品。当前公开版本为 2.2.0 预览版，存在已知交互问题，尚未经过 Apple 公证。**

## 下载与安装

前往 [Releases 下载页面](https://github.com/Ian6733227/coze-account-browser/releases/tag/v2.2.0)，下载 `CozeAccountBrowser-2.2.0-macos-arm64.zip`。无需下载 `Source code`，无需另外安装 Chrome 或 Node.js。

- 支持：Apple 芯片 Mac（arm64），macOS 13 或更高版本；本机已验证 arm64，未覆盖所有 macOS 版本。
- 未提供：Intel Mac、Windows、Linux、iOS 或 Android 安装包。
- 下载页提供 `SHA256SUMS.txt`，可用 `shasum -a 256 CozeAccountBrowser-2.2.0-macos-arm64.zip` 对照文件完整性。

1. 解压 ZIP，将“扣子账号浏览器.app”拖入“应用程序”文件夹。
2. 打开应用，选择左侧账号，在右侧扣子官网页面自行登录。
3. 依次为其他入口登录不同账号；点击 `＋` 添加更多入口。

本版本仅有 ad-hoc 本地签名，没有 Developer ID 签名与 Apple 公证。首次打开可能被 macOS 拦截。确认来源和校验值后，可参考 [Apple 官方打开说明](https://support.apple.com/zh-cn/102445)，在“系统设置 → 隐私与安全性”中处理该应用的“仍要打开”提示。不要关闭系统整体安全保护；如果系统报告恶意软件或文件损坏，停止使用并检查下载来源。

## 使用方式

- 点击左侧头像切换账号，或用 `⌘1` 至 `⌘9` 切换前九个未隐藏入口。
- 收起侧栏后仅保留头像与状态；悬停查看名称。
- “同步头像昵称”尝试读取当前登录账号自己的昵称和头像；也可以编辑名称、备注与自定义头像。
- “打开全部账号”让所有未隐藏账号的网页保持打开。绿点仅表示页面进程状态，不证明已经登录或 Agent 任务执行成功。
- “停用”目前表示隐藏入口，网页可能继续后台运行；勾选“显示已停用账号”可找回。
- “暂停网页”会关闭该账号页面，可能中断任务；登录资料保留。
- 刷新使用 `⌘R` 或 macOS“网页”菜单。应用退出后网页停止运行。

## 其他软件直接控制

内置 CLI 通过本机 Unix socket 通信，不需要 Computer Use。安装到“应用程序”后可直接调用：

```sh
"/Applications/扣子账号浏览器.app/Contents/Resources/app/bin/coze-browser" launch
"/Applications/扣子账号浏览器.app/Contents/Resources/app/bin/coze-browser" accounts
"/Applications/扣子账号浏览器.app/Contents/Resources/app/bin/coze-browser" switch 2
"/Applications/扣子账号浏览器.app/Contents/Resources/app/bin/coze-browser" open https://www.coze.cn/ --account 2
```

详细说明见 [CONTROL-CLI.md](CONTROL-CLI.md)。目前可以切换账号、打开网页和查询状态，**尚未接入选择 Agent、下发任务、获取进度、取消任务或取回结果的协议**。

## 隐私与数据

公开源码和下载包不包含作者的登录状态、个人头像、真实账号列表或聊天记录。使用者需要自行登录。

使用数据保存在 `~/Library/Application Support/CozeAccountsBrowser/`，包括账号显示设置和各自的 Chromium Session。不要把这个目录提交到 GitHub、发给别人或附在问题报告里。清空该目录会丢失本机资料；源码备份不等于账号资料备份。

登录与网页操作会连接扣子及其相关服务。账号之间使用独立的浏览器 Session，但仍属于同一个 macOS 用户和应用；不是操作系统级别的独立容器。首次运行可继承旧版本的账号名称与备注，不迁移 Chrome/Brave 的登录资料。

## 已知限制

- 编辑弹窗打开期间，账号快捷键仍能切换背景账号；编辑时请先保存或取消，再切账号。
- 页面加载失败可能仍显示绿点，请同时检查网页和底部错误提示。
- 无头像且昵称首字相同的账号，收起侧栏后可能难以区分；可使用自定义头像或展开侧栏。
- 隐藏当前账号后的选中状态和数量提示不够清楚；状态更新还可能丢失键盘焦点。
- 重启默认打开第一个未隐藏账号，不恢复上次的账号与页面位置。
- 头像同步依赖网站当前接口，网站升级后可能需要调整。
- 默认拒绝摄像头、麦克风与位置权限。真实第三方登录、上传下载和长期后台任务没有完整验收。
- 未做与 Brave 相同负载的内存对比，不能承诺更省内存。

## 从源码运行与构建

使用 Node.js 24 LTS；本次验证使用 Node.js 24.21.0。Electron 固定为 44.5.1。构建脚本面向 Apple Silicon macOS。

```sh
git clone https://github.com/Ian6733227/coze-account-browser.git
cd coze-account-browser/embedded
npm ci
npm test
npm run test:browser
npm run package
npm run test:control-launch
npm start
```

测试使用匿名临时资料。开发时也可使用独立资料目录：

```sh
npm start -- --data-root /tmp/coze-browser-development
```

打包输出在 `embedded/dist/`，不进入源码 Git。首次公开版本来自现有 2.2.0 程序的干净打包快照，运行时代码保持一致；验证细节见 [RELEASE-CHECK.md](RELEASE-CHECK.md)。原来的内部开发历史和业务记录未纳入此公开仓库。

## 来源与反馈

本项目使用 Electron/Chromium。运行时第三方许可随应用包附带，图标来源见 [assets/README.md](embedded/assets/README.md)。扣子/Coze 名称与图标归各自权利人；公开本工具不表示获得官方背书。

可在 [Issues](https://github.com/Ian6733227/coze-account-browser/issues) 提交问题，请提供系统版本、应用版本和脱敏后的复现步骤，不要附登录资料或完整用户数据目录。
