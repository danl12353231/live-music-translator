const languages = {
  none: "No translation", en: "English", it: "Italian", es: "Spanish", fr: "French",
  de: "German", pt: "Portuguese", nl: "Dutch", pl: "Polish", ru: "Russian",
  uk: "Ukrainian", ja: "Japanese", ko: "Korean", zh: "Chinese", ar: "Arabic",
  hi: "Hindi", tr: "Turkish", sv: "Swedish", da: "Danish", no: "Norwegian",
  fi: "Finnish", cs: "Czech", el: "Greek", he: "Hebrew", ro: "Romanian",
  hu: "Hungarian", id: "Indonesian", vi: "Vietnamese", th: "Thai"
};

const elements = Object.fromEntries([
  "panel", "track", "language", "status-dot", "original", "translation", "lyrics",
  "settings", "settings-button", "target-language", "offset", "earlier", "later",
  "minimize", "close", "translator-status", "install-translator", "translator-progress"
].map((id) => [id, document.getElementById(id)]));

let preferences;
let showingSettings = false;

for (const [code, label] of Object.entries(languages)) {
  const option = document.createElement("option");
  option.value = code;
  option.textContent = label;
  elements["target-language"].append(option);
}

window.lingua.initial().then(({ state, preferences: initialPreferences }) => {
  preferences = initialPreferences;
  renderPreferences();
  render(state);
});
window.lingua.onState(render);

elements["settings-button"].addEventListener("click", () => {
  showingSettings = !showingSettings;
  elements.settings.hidden = !showingSettings;
  elements.lyrics.hidden = showingSettings;
});
elements["target-language"].addEventListener("change", (event) => updatePreferences({ targetLanguage: event.target.value }));
elements.earlier.addEventListener("click", () => updatePreferences({ timingOffset: preferences.timingOffset + 0.25 }));
elements.later.addEventListener("click", () => updatePreferences({ timingOffset: preferences.timingOffset - 0.25 }));
elements["install-translator"].addEventListener("click", installTranslator);
elements.minimize.addEventListener("click", window.lingua.minimize);
elements.close.addEventListener("click", window.lingua.close);

async function updatePreferences(patch) {
  preferences = await window.lingua.setPreferences(patch);
  renderPreferences();
}

function renderPreferences() {
  if (!preferences) return;
  elements["target-language"].value = preferences.targetLanguage;
  elements.offset.textContent = `${preferences.timingOffset >= 0 ? "+" : ""}${preferences.timingOffset.toFixed(2)}s`;
  document.documentElement.style.setProperty("--panel-opacity", preferences.opacity);
}

function render(state) {
  const track = state.track;
  elements.track.textContent = track ? `${track.title} — ${track.artist}` : "Live Music Translator";
  elements.language.textContent = state.detectedLanguage === "und" ? "" : state.detectedLanguage;
  elements["status-dot"].className = state.status;
  elements.original.textContent = state.currentLine || state.message || "♪";
  elements.translation.textContent = state.translation || "";
  renderTranslator(state.translationStatus);
}

async function installTranslator() {
  elements["install-translator"].disabled = true;
  try {
    await window.lingua.installTranslator();
  } catch (error) {
    elements["translator-status"].textContent = error.message || "Model installation failed";
    elements["install-translator"].disabled = false;
  }
}

function renderTranslator(status = {}) {
  const phase = status.phase || "checking";
  elements["translator-status"].textContent = status.message || "Checking local model…";
  const downloading = phase === "downloading";
  elements["translator-progress"].hidden = !downloading;
  elements["translator-progress"].value = Number.isFinite(status.progress) ? status.progress : 0;
  elements["install-translator"].hidden = ["installed", "loading", "ready"].includes(phase);
  elements["install-translator"].disabled = downloading || phase === "checking";
  if (phase === "error") {
    elements["install-translator"].textContent = status.downloaded === status.total ? "Try translator again" : "Try download again";
  }
}
