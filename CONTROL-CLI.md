# 本机控制 CLI

这是本工具自己的账号和页面控制接口，并非扣子官方 CLI 或 Agent 任务 API。接口只在当前机器提供 Unix socket，不监听网络端口。

## 调用

如果应用安装在 `/Applications`，直接调用包内入口即可，无需安装额外 Node.js：

```sh
coze_cli="/Applications/扣子账号浏览器.app/Contents/Resources/app/bin/coze-browser"
"$coze_cli" launch
"$coze_cli" accounts
"$coze_cli" status
"$coze_cli" switch 2
"$coze_cli" open https://www.coze.cn/ --account 2
"$coze_cli" open-all
"$coze_cli" sidebar collapse
"$coze_cli" sidebar expand
"$coze_cli" endpoint
```

应用安装在用户个人 `~/Applications` 时，将第一行路径替换为该实际位置。脚本需要通过这个包内入口运行，或设置 `COZE_BROWSER_APP` 指向实际应用路径；不建议把脚本复制后依赖默认安装位置。

`switch` 接受账号编号、固定 ID 或唯一名称。同名时使用编号或固定 ID；长期集成建议使用 `accounts` 返回的固定 ID。

控制结果为 JSON：`ok`、`requestId` 与 `result`，或失败时的 `error`。退出码：成功 0，操作失败 1，参数错误 2。支持 `--timeout 10000`（100–30000 毫秒）和 `--data-root <独立资料目录>`；自定义资料目录必须与应用启动时一致。

`open` 只接受允许的扣子官方 HTTPS 页面，不接受任意网站、文件、JavaScript、接口路径或认证参数。返回 `navigation_started` 仅表示开始导航，仍需查 `status` 检查加载和错误；不是 Agent 任务完成回执。

## 直接 IPC

运行 `endpoint` 获取当前资料目录对应的 socket 路径和协议版本；不要硬编码临时目录名。协议版本为 1，每条请求/响应为以换行结尾的一行 JSON。请求字段与校验见 `embedded/src/control.cjs` 和 `control-transport.cjs`。

Socket 目录权限 0700，socket 权限 0600，仅供当前本机用户调用。编辑或确认窗口打开时，改变状态的 CLI 命令返回 `UI_BUSY`；先完成窗口操作再重试。

输出包含账号显示名、ID、网页位置与加载状态，请在日志中按个人资料处理。接口不返回 Cookie、Token、密码、头像、备注或聊天正文；不提供任意脚本执行、发消息、远程控制或 Agent 调度。
