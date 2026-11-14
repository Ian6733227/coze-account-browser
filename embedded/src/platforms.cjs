'use strict';

const platforms = Object.freeze({
  coze: { label: '扣子', home: 'https://www.coze.cn/' },
  workbuddy: { label: 'WorkBuddy', home: 'https://www.workbuddy.cn/app' },
  doubao: { label: '豆包', home: 'https://www.doubao.com/chat/' },
  aily: { label: 'Aily', home: 'https://aily.feishu.cn/' },
  qwenwork: { label: '千问办公', home: 'https://qwenwork.cn/app' }
});

function knownPlatform(id) { return typeof id === 'string' && Object.hasOwn(platforms, id); }
function matchesPlatform(account, view) { return view === 'all' || (account.platform || 'coze') === view; }

module.exports = { platforms, knownPlatform, matchesPlatform };
