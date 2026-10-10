# 扣子账号浏览器 · 使用与开发说明

[返回产品介绍](README.md) · [下载最新版](https://github.com/Ian6733227/coze-account-browser/releases/latest)

## 使用方式

- 点击左侧头像切换账号，或用 `⌘1` 至 `⌘9` 切换前九个未隐藏入口。
- 收起侧栏后仅保留头像与状态；悬停查看名称。
- “同步头像昵称”尝试读取当前登录账号自己的昵称和头像；也可以编辑名称、备注与自定义头像。
- “打开全部账号”让所有未隐藏账号的网页保持打开。绿点仅表示页面进程状态，不证明已经登录或 Agent 任务执行成功。
- “停用”表示隐藏入口，网页可能继续后台运行；当前选中入口仍保留，方便恢复。勾选“显示已停用账号”可找回其他入口。
- “暂停网页”会关闭该账号页面，可能中断任务；登录资料保留。
- 刷新使用 `⌘R` 或 macOS“网页”菜单。普通退出直接关闭应用，不再弹确认框；网页停止运行，登录资料保留。

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
