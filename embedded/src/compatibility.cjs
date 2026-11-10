'use strict';
function checkedVersion(reply, expected) {
  if (reply?.ok && reply.result?.version !== expected) {
    const actual = reply.result?.version || '未知';
    throw Object.assign(new Error(`当前运行的是 ${actual}，此程序是 ${expected}。请先正常退出当前浏览器，再从正式安装位置启动；账号资料会保留。`), { code: 'VERSION_MISMATCH' });
  }
  return reply;
}
module.exports = { checkedVersion };
