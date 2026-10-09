'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('coze', Object.freeze({
  state: () => ipcRenderer.invoke('coze:state'),
  sidebar: collapsed => ipcRenderer.invoke('coze:sidebar', collapsed),
  select: id => ipcRenderer.invoke('coze:select', id),
  openAll: () => ipcRenderer.invoke('coze:open-all'),
  add: (name, note, useProfileName) => ipcRenderer.invoke('coze:add', { name, note, useProfileName }),
  edit: (id, name, note, useProfileName, avatarMode, customAvatar) => ipcRenderer.invoke('coze:edit', { id, name, note, useProfileName, avatarMode, customAvatar }),
  syncProfile: id => ipcRenderer.invoke('coze:sync-profile', id),
  chooseAvatar: id => ipcRenderer.invoke('coze:choose-avatar', id),
  archive: id => ipcRenderer.invoke('coze:archive', id),
  pause: id => ipcRenderer.invoke('coze:pause', id),
  navigation: action => ipcRenderer.invoke('coze:navigation', action),
  tab: id => ipcRenderer.invoke('coze:tab', id),
  closeTab: () => ipcRenderer.invoke('coze:close-tab'),
  overlay: visible => ipcRenderer.invoke('coze:overlay', visible === true),
  onState: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('coze:update', listener);
    return () => ipcRenderer.removeListener('coze:update', listener);
  }
}));
