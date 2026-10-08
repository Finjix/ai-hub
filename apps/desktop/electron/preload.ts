import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopSnapshot } from '@ai-hub/shared';
const bridge: DesktopBridge = {
  snapshot: () => ipcRenderer.invoke('hub:snapshot'),
  connect: (url) => ipcRenderer.invoke('hub:connect', url),
  refresh: () => ipcRenderer.invoke('hub:refresh'),
  detail: (id) => ipcRenderer.invoke('hub:detail', id),
  install: (id) => ipcRenderer.invoke('hub:install', id),
  uninstall: (name) => ipcRenderer.invoke('hub:uninstall', name),
  checkAppUpdate: () => ipcRenderer.invoke('hub:check-update'),
  restartForUpdate: () => ipcRenderer.invoke('hub:restart-update'),
  openAdmin: () => ipcRenderer.invoke('hub:open-admin'),
  openFolder: () => ipcRenderer.invoke('hub:open-folder'),
  onChange: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: DesktopSnapshot) => callback(state);
    ipcRenderer.on('hub:changed', listener);
    return () => { ipcRenderer.removeListener('hub:changed', listener); };
  },
};
contextBridge.exposeInMainWorld('aiHub', bridge);
