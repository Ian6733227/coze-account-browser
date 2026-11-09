# 本机浏览器控制 CLI / IPC v1

适用：扣子账号浏览器2.3.6，Apple Silicon macOS。此入口控制本机浏览器，不调用官方Coze CLI，也不发送扣子对话消息。

## 使用

本机命令安装到 `~/.local/bin/coze-browser`；也可直接运行应用包的 `Contents/Resources/app/bin/coze-browser`。使用应用内附带的Node运行时，无需另装Node或npm依赖。其他软件执行命令时建议使用绝对路径，避免PATH差异。

```sh
~/.local/bin/coze-browser launch
~/.local/bin/coze-browser accounts
~/.local/bin/coze-browser switch 2
~/.local/bin/coze-browser open 'https://www.coze.cn/' --account 5
~/.local/bin/coze-browser status
~/.local/bin/coze-browser open-all
~/.local/bin/coze-browser sidebar collapse
~/.local/bin/coze-browser sidebar expand
```

所有控制结果默认JSON，`--json`可显式标记；帮助是纯文本。成功退出码0，服务/控制失败1，参数错误2。编号按完整列表位置，含已隐藏入口，保持与列表编号一致；固定ID更适合长期脚本。名称可用，但重复名称会返回AMBIGUOUS_ACCOUNT，不能猜测目标。隐藏入口不接受switch/open，请先在界面显示该入口。

`open`只接受coze.cn、www.coze.cn、space.coze.cn的HTTPS首页、session/project/space/task/chat/workspaces/agent/agents/store/overview/home页面路径。拒绝端口、URL凭据、接口路径及认证参数。在账号内新增页签或选回完全相同的已打开页面，保留原页面和后台任务；每个账号最多由该命令打开到32个页面。open结果中的navigation_started只表示开始导航；需继续查询status中的pages.loading/error判断加载，不表示扣子任务已完成。

账号编辑或确认窗口打开时，修改类命令返回UI_BUSY，请先完成当前操作；status/accounts仍可查。status的账号running只表示网页已打开，不证明登录有效。

默认只控制当前用户的正常资料目录；`--data-root /absolute/path`可连接单独测试实例，不能用于读取或复制登录资料。请求默认10秒超时，可设`--timeout 100–30000`。超时后先查询状态，不自动重发修改命令。launch启动应用并等待接口就绪，旧版仍运行时需要正常退出再launch。不会自动杀进程、退出网页或清除登录。

## 直接IPC

无需启动CLI子进程，Node、Python等也能直接通信：

1. `coze-browser endpoint`返回socket路径；该命令只定位端点，不证明服务在线。
2. 连接Unix domain socket，发送一行UTF-8 JSON加换行。
3. 接收一行JSON并关闭连接，每个连接仅处理一个请求。

请求示例（requestId由调用者唯一生成，字母/数字/连字符，最长64）：

```json
{"v":1,"requestId":"my-request-001","command":"switch","account":"2"}
```

```json
{"v":1,"requestId":"my-request-002","command":"open","account":"5","url":"https://www.coze.cn/"}
```

命令参数：status/accounts/open-all不带额外参数；switch需要字符串account；open需要url、可选字符串account（省略使用当前账号）；sidebar需要布尔collapsed。拒绝未知命令、未知字段和其他协议版本。响应结构为`{ok,requestId,result}`或`{ok:false,requestId,error:{code,message}}`，调用者应核对requestId；无合法ID/JSON等协议错误可能没有ID。status.result.protocolVersion=1。

直接Node示例（以下文件路径替换为endpoint返回值）：

```js
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const socket = net.createConnection('/path/from/endpoint/control.sock');
const requestId = randomUUID();
socket.setEncoding('utf8');
socket.setTimeout(10000, () => socket.destroy(new Error('timeout; query status before retry')));
let input = '';
socket.on('connect', () => socket.write(JSON.stringify({v:1,requestId,command:'switch',account:'2'})+'\n'));
socket.on('data', chunk => {
  input += chunk;
  if (Buffer.byteLength(input) > 1024 * 1024) return socket.destroy(new Error('response too large'));
  const end = input.indexOf('\n');
  if (end < 0) return;
  try {
    const reply = JSON.parse(input.slice(0,end));
    if (reply.requestId !== requestId) throw new Error('requestId mismatch');
    console.log(reply);
  } catch (error) { console.error(error.message); }
  socket.destroy();
});
socket.on('error', error => console.error(error.message));
```

## 权限与数据

只开Unix socket，不监听TCP端口或HTTP服务；网页无法通过HTTP/fetch调用。端点按真实资料路径和本机用户ID定位，路径短于macOS socket长度上限；目录0700、socket0600，客户端核对归属、类型及权限。不覆盖已运行服务、符号链接或普通文件；只清理当前用户拥有的失效私有socket。请求限制16KiB、32连接/排队请求，5秒无输入断开。属于同一macOS用户下程序的控制通道，不隔离同用户恶意本地程序。

只暴露账号编号/本机固定ID/显示名/选中与运行状态，以及页面ID、活动状态、加载/错误状态和不含query/hash的允许页面地址。没有Cookie、Token、头像、备注、原始网页正文、任意JavaScript执行、任意文件读写、消息发送、暂停/退出/删除接口。关闭功能可在启动参数加`--no-control`，再使用时正常退出并去掉该参数重开。

源码位于embedded/src/control*.cjs、cli.cjs和embedded/bin/coze-browser；bin脚本随应用包保存，外部安装副本可由这里恢复。个人资料和运行socket不进入源码备份。接口为本机单用户用途，未提供跨电脑远程控制。

依据：[Node Unix IPC](https://nodejs.org/api/net.html#ipc-support)。

2.3.5：launch的首次、第二次探测及启动后连接均核对版本；旧版实例不会报作新版成功。CLI不提供清除登录资料接口，此操作必须在应用内具名确认。
