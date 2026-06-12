import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('neuralscope', {
  isDesktop: true,
  openPath: (p: string) => ipcRenderer.invoke('ns:openPath', p),
  openExternal: (u: string) => ipcRenderer.invoke('ns:openExternal', u),
});
