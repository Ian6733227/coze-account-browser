'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('coze', Object.freeze({
  state: () => ipcRenderer.invoke('coze:state'),
  platformMenu: () => ipcRenderer.invoke('coze:platform-menu'),
  sidebar: collapsed => ipcRenderer.invoke('coze:sidebar', collapsed),
  accountMenu: (id, x, y, showArchived) => ipcRenderer.invoke('coze:account-menu', { id, x, y, showArchived }),
  select: id => ipcRenderer.invoke('coze:select', id),
  openAll: () => ipcRenderer.invoke('coze:open-all'),
  add: (name, note, useProfileName, platform) => ipcRenderer.invoke('coze:add', { name, note, useProfileName, platform }),
  edit: (id, name, note, useProfileName, avatarMode, customAvatar) => ipcRenderer.invoke('coze:edit', { id, name, note, useProfileName, avatarMode, customAvatar }),
  syncProfile: id => ipcRenderer.invoke('coze:sync-profile', id),
  chooseAvatar: id => ipcRenderer.invoke('coze:choose-avatar', id),
  archive: id => ipcRenderer.invoke('coze:archive', id),
  pause: id => ipcRenderer.invoke('coze:pause', id),
  clearAccountData: id => ipcRenderer.invoke('coze:clear-account-data', id),
  deleteAccount: id => ipcRenderer.invoke('coze:delete-account', id),
  navigation: action => ipcRenderer.invoke('coze:navigation', action),
  tab: id => ipcRenderer.invoke('coze:tab', id),
  closeTab: () => ipcRenderer.invoke('coze:close-tab'),
  overlay: visible => ipcRenderer.invoke('coze:overlay', visible === true),
  onHelp: callback => {
    const listener = () => callback();
    ipcRenderer.on('coze:show-help', listener);
    return () => ipcRenderer.removeListener('coze:show-help', listener);
  },
  onState: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('coze:update', listener);
    return () => ipcRenderer.removeListener('coze:update', listener);
  }
}));
