import { app, BrowserWindow, ipcMain, screen } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPlayback, trackKey } from "./playback/index.js";
import { findSyncedLyrics } from "./core/lyrics-client.js";
import { activeLineIndex } from "./core/lrc.js";
import { detectLanguage } from "./core/language.js";
import { Translator } from "./core/translator.js";
import { GEMMA_MODEL, ModelManager } from "./core/model-manager.js";
import { LocalTranslationHost } from "./translation/host.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let translator;
let translationHost;
let translationInstallPromise;
let modelManager;
let window;
let pollTimer;
let lineTimer;
let pollInFlight = false;
let startupReady = false;
let lyricAbort;
let loadingKey = "";
let lyricRetryAt = 0;
let lastLineIndex = -2;
let preferences = {
  targetLanguage: "en",
  timingOffset: 0,
  opacity: 0.94
};
let state = {
  status: "waiting",
  message: "Play a song to begin",
  track: null,
  lyrics: null,
  detectedLanguage: "und",
  currentLine: "",
  translation: "",
  lineIndex: -1,
  translationStatus: {
    phase: "checking",
    progress: 0,
    message: "Checking local model…"
  }
};

app.whenReady().then(async () => {
  preferences = { ...preferences, ...sanitizePreferences(await loadPreferences()) };
  modelManager = new ModelManager(path.join(app.getPath("userData"), "models"), {
    bundledPath: app.isPackaged
      ? path.join(process.resourcesPath, "models", GEMMA_MODEL.fileName)
      : path.join(here, "..", "models", GEMMA_MODEL.fileName),
    onStatus: updateTranslationStatus
  });
  await modelManager.check();
  registerIPC();
  const modelInstalled = modelManager.status().phase === "installed";
  if (modelInstalled) {
    try {
      const host = await ensureTranslationHost();
      await host.initialize();
    } catch { /* The visible app will report the initialization error. */ }
  }
  startupReady = true;
  createWindow();
  const mediaPollMilliseconds = process.platform === "win32" ? 2000 : 1000;
  pollTimer = setInterval(pollSafely, mediaPollMilliseconds);
  lineTimer = setInterval(updateLine, 150);
  await pollSafely();
  if (!modelInstalled) void installTranslation().catch(() => {});
});

app.on("window-all-closed", () => {
  clearInterval(pollTimer);
  clearInterval(lineTimer);
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!startupReady) return;
  if (!window || window.isDestroyed()) createWindow();
  else window?.show();
});

app.on("before-quit", () => {
  translationHost?.close().catch(() => {});
});

function createWindow() {
  const display = screen.getPrimaryDisplay().workArea;
  window = new BrowserWindow({
    width: 760,
    height: 210,
    minWidth: 430,
    minHeight: 160,
    x: Math.round(display.x + (display.width - 760) / 2),
    y: display.y + display.height - 250,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    hasShadow: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.loadFile(path.join(here, "renderer", "index.html"));
  window.on("closed", () => { window = null; });
  window.once("ready-to-show", () => {
    window.showInactive();
    sendState();
    const screenshotPath = process.env.LIVE_MUSIC_TRANSLATOR_SCREENSHOT_PATH;
    if (screenshotPath) {
      const screenshotDelay = Math.max(400, Number(process.env.LIVE_MUSIC_TRANSLATOR_SCREENSHOT_DELAY) || 400);
      setTimeout(async () => {
        const image = await window.webContents.capturePage();
        await writeFile(screenshotPath, image.toPNG());
        app.quit();
      }, screenshotDelay);
    }
  });
}

function registerIPC() {
  ipcMain.handle("app:get-initial", () => ({ state: publicState(), preferences: publicPreferences() }));
  ipcMain.handle("app:set-preferences", async (_event, patch) => {
    const allowed = sanitizePreferences(patch);
    const targetChanged = allowed.targetLanguage && allowed.targetLanguage !== preferences.targetLanguage;
    preferences = { ...preferences, ...allowed };
    await savePreferences();
    if (targetChanged) {
      translator.clear();
      lastLineIndex = -2;
      state.translation = "";
    }
    sendState();
    return publicPreferences();
  });
  ipcMain.handle("translation:install", async () => {
    await installTranslation();
    return state.translationStatus;
  });
  ipcMain.on("window:minimize", () => window?.minimize());
  ipcMain.on("window:close", () => process.platform === "darwin" ? window?.close() : app.quit());
}

async function poll() {
  let track = null;
  try { track = await readPlayback(); } catch { /* A missing platform integration is normal. */ }

  if (!track) {
    if (state.track && Date.now() - (state.track.sampledAt || 0) < 4000) return updateLine();
    state = { ...state, status: "waiting", message: "Play a song to begin", track: null, currentLine: "", translation: "", lineIndex: -1 };
    return sendState();
  }
  await acceptTrack(track);
}

async function pollSafely() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    await poll();
  } finally {
    pollInFlight = false;
  }
}

async function acceptTrack(track) {
  const newKey = trackKey(track);
  const oldKey = trackKey(state.track);
  state.track = track;

  const retryingFailedLookup = state.status === "lyrics-unavailable" && Date.now() >= lyricRetryAt;
  if ((newKey !== oldKey || retryingFailedLookup) && newKey !== loadingKey) {
    const isBackgroundRetry = retryingFailedLookup && newKey === oldKey;
    loadingKey = newKey;
    lyricRetryAt = 0;
    lastLineIndex = -2;
    lyricAbort?.abort();
    lyricAbort = new AbortController();
    if (!isBackgroundRetry) {
      state = { ...state, track, lyrics: null, status: "loading", message: "Finding synced lyrics…", currentLine: "", translation: "", lineIndex: -1 };
      sendState();
    }
    try {
      const lyrics = await findSyncedLyrics(track, lyricAbort.signal);
      if (newKey !== trackKey(state.track)) return;
      if (!lyrics?.lines.length) {
        state = { ...state, status: "no-lyrics", message: lyrics?.instrumental ? "Instrumental track" : "No synced lyrics found" };
      } else {
        const language = detectLanguage(lyrics.lines.map((line) => line.text).join(" "));
        state = { ...state, lyrics, detectedLanguage: language, status: "ready", message: "" };
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        lyricRetryAt = Date.now() + 15_000;
        const timedOut = error.name === "TimeoutError" || /timeout/i.test(error.message);
        state = {
          ...state,
          status: "lyrics-unavailable",
          message: timedOut ? "Lyrics service unavailable — retrying…" : `Lyrics lookup failed — retrying…`
        };
        sendState();
      }
    } finally {
      if (loadingKey === newKey) loadingKey = "";
    }
  }
  updateLine();
}

function updateLine() {
  if (!state.track || !state.lyrics?.lines.length) return sendState();
  const track = extrapolate(state.track);
  const index = activeLineIndex(state.lyrics.lines, track.position, preferences.timingOffset);
  if (index === lastLineIndex) return;
  lastLineIndex = index;
  const original = index >= 0 ? state.lyrics.lines[index].text : "♪";
  state = { ...state, currentLine: original, translation: "", lineIndex: index };
  sendState();

  const shouldTranslate = preferences.targetLanguage !== "none" && state.detectedLanguage !== preferences.targetLanguage;
  if (index < 0 && shouldTranslate && state.translationStatus.phase === "ready" && translator) {
    void translator.prefetch(upcomingLines(0), state.detectedLanguage, preferences.targetLanguage);
    return;
  }

  if (index >= 0 && shouldTranslate) {
    if (state.translationStatus.phase !== "ready" || !translator) {
      state.translation = translationPlaceholder(state.translationStatus);
      return sendState();
    }
    const expectedKey = trackKey(state.track);
    translator.translate(original, state.detectedLanguage, preferences.targetLanguage)
      .then((translation) => {
        if (trackKey(state.track) === expectedKey && state.lineIndex === index) {
          state.translation = translation;
          sendState();
          void translator.prefetch(upcomingLines(index + 1), state.detectedLanguage, preferences.targetLanguage);
        }
      })
      .catch((error) => {
        if (state.lineIndex === index) {
          state.translation = /cancel/i.test(error.message) ? "" : "Translation unavailable";
          sendState();
        }
      });
  }
}

function upcomingLines(startIndex) {
  return state.lyrics?.lines.slice(startIndex, startIndex + 8).map((line) => line.text) || [];
}

function extrapolate(track) {
  const elapsed = track.playing ? Math.max(0, Date.now() - track.sampledAt) / 1000 : 0;
  return { ...track, position: track.position + elapsed, sampledAt: Date.now() };
}

function sendState() {
  if (window && !window.isDestroyed()) window.webContents.send("app:state", publicState());
}

function publicState() {
  return { ...state, lyrics: state.lyrics ? { source: state.lyrics.source, count: state.lyrics.lines.length } : null };
}

function publicPreferences() {
  return { ...preferences };
}

function sanitizePreferences(patch = {}) {
  const value = {};
  if (typeof patch.targetLanguage === "string" && /^[a-z]{2,3}$|^none$/.test(patch.targetLanguage)) value.targetLanguage = patch.targetLanguage;
  if (Number.isFinite(patch.timingOffset)) value.timingOffset = Math.max(-10, Math.min(10, patch.timingOffset));
  if (Number.isFinite(patch.opacity)) value.opacity = Math.max(0.55, Math.min(1, patch.opacity));
  return value;
}

function preferencesPath() {
  return path.join(app.getPath("userData"), "preferences.json");
}

async function loadPreferences() {
  try { return JSON.parse(await readFile(preferencesPath(), "utf8")); } catch { return {}; }
}

async function savePreferences() {
  await mkdir(path.dirname(preferencesPath()), { recursive: true });
  await writeFile(preferencesPath(), JSON.stringify(preferences, null, 2), "utf8");
}

async function ensureTranslationHost() {
  if (translationHost) return translationHost;
  translationHost = new LocalTranslationHost({
    helperPath: nativeHelperPath(),
    modelPath: modelManager.modelPath,
    cachePath: path.join(app.getPath("userData"), "native-cache"),
    onStatus: updateTranslationStatus
  });
  translator = new Translator(translationHost);
  return translationHost;
}

function installTranslation() {
  if (translationInstallPromise) return translationInstallPromise;
  translationInstallPromise = (async () => {
    await modelManager.download();
    const host = await ensureTranslationHost();
    await host.initialize();
  })().finally(() => { translationInstallPromise = null; });
  return translationInstallPromise;
}

function nativeHelperPath() {
  const executable = process.platform === "win32" ? "live-music-translator-helper.exe" : "live-music-translator-helper";
  if (app.isPackaged) return path.join(process.resourcesPath, "native", executable);
  return path.join(here, "..", "native", "release", executable);
}

function updateTranslationStatus(status) {
  state.translationStatus = { ...state.translationStatus, ...status };
  if (status.phase === "ready") {
    lastLineIndex = -2;
    updateLine();
  } else {
    sendState();
  }
}

function translationPlaceholder(status) {
  if (status.phase === "not-installed") return "Gemma will download automatically for offline translation";
  if (status.phase === "downloading") return status.message;
  if (status.phase === "checking" || status.phase === "installed" || status.phase === "loading") return "Preparing local translation…";
  if (status.phase === "unsupported") return "Local translation is unavailable on this computer";
  if (status.phase === "error") return "Local translator could not start";
  return "";
}
