const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = channel => fn => ipcRenderer.on(channel, (_e, ...args) => fn(...args));

contextBridge.exposeInMainWorld('recto', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveSettings: s => ipcRenderer.invoke('settings:save', s),
  saveSessionSync: s => ipcRenderer.sendSync('session:saveSync', s),
  setTheme: colours => ipcRenderer.invoke('window:theme', colours),
  setupShell: choice => ipcRenderer.invoke('setup:shell', choice),
  readFile: p => ipcRenderer.invoke('file:read', p),
  writeFile: (p, content, encoding, bom) => ipcRenderer.invoke('file:write', p, content, encoding, bom),
  searchFolder: (root, q) => ipcRenderer.invoke('folder:search', root, q),
  editAction: (name, arg) => ipcRenderer.invoke('edit:action', name, arg),
  openDialog: () => ipcRenderer.invoke('file:open-dialog'),
  saveDialog: (p, filters) => ipcRenderer.invoke('file:save-dialog', p, filters),
  printPdf: (html, p) => ipcRenderer.invoke('doc:pdf', html, p),
  printDoc: html => ipcRenderer.invoke('doc:print', html),
  writeZip: (p, parts) => ipcRenderer.invoke('doc:zip', p, parts),
  folderDialog: () => ipcRenderer.invoke('folder:open-dialog'),
  listFolder: p => ipcRenderer.invoke('folder:list', p),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openUpdate: () => ipcRenderer.invoke('update:open'),
  folderFiles: p => ipcRenderer.invoke('folder:files', p),
  askUnsaved: name => ipcRenderer.invoke('dialog:unsaved', name),
  reveal: p => ipcRenderer.invoke('shell:reveal', p),
  watch: paths => ipcRenderer.invoke('file:watch', paths),
  pathForFile: f => webUtils.getPathForFile(f),
  onOpenFiles: on('open-files'),
  onFileChanged: on('file:changed'),
  onSystemTheme: on('system-theme'),
  onContextMenu: on('context-menu'),
});
