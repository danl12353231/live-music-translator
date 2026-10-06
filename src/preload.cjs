const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lingua", {
  initial: () => ipcRenderer.invoke("app:get-initial"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("app:state", listener);
    return () => ipcRenderer.removeListener("app:state", listener);
  },
  setPreferences: (preferences) => ipcRenderer.invoke("app:set-preferences", preferences),
  installTranslator: () => ipcRenderer.invoke("translation:install"),
  minimize: () => ipcRenderer.send("window:minimize"),
  close: () => ipcRenderer.send("window:close")
});
