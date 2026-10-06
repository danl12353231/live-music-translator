import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModelManager } from "../src/core/model-manager.js";
import { Translator } from "../src/core/translator.js";
import { LocalTranslationHost } from "../src/translation/host.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
app.setName("live-music-translator");

app.whenReady().then(runSmokeTest);

async function runSmokeTest() {
  let host;
  let lastPercent = -1;
  try {
    const manager = new ModelManager(path.join(root, "models"), {
      bundledPath: process.env.LIVE_MUSIC_TRANSLATOR_SMOKE_MODEL,
      onStatus(status) {
        if (status.phase === "downloading") {
          const percent = Math.floor(status.progress * 100);
          if (percent !== lastPercent) {
            lastPercent = percent;
            console.log(`MODEL_DOWNLOAD ${percent}%`);
          }
        } else {
          console.log(`MODEL_STATUS ${status.phase}: ${status.message}`);
        }
      }
    });
    await manager.check();
    if (manager.status().phase !== "installed") await manager.download();
    host = new LocalTranslationHost({
      helperPath: process.env.LIVE_MUSIC_TRANSLATOR_SMOKE_HELPER || path.join(root, "native", "release", process.platform === "win32" ? "live-music-translator-helper.exe" : "live-music-translator-helper"),
      modelPath: manager.modelPath,
      cachePath: path.join(app.getPath("userData"), "native-cache-smoke"),
      onStatus: (status) => console.log(`ENGINE_STATUS ${status.phase}: ${status.message}`)
    });
    const translator = new Translator(host);
    const result = await translator.translate("Ciao, come stai?", "it", "en");
    console.log(`TRANSLATION_RESULT ${result}`);
    if (!/hello|hi/i.test(result)) throw new Error(`Unexpected translation: ${result}`);
    if (process.env.LIVE_MUSIC_TRANSLATOR_STRESS === "1") await stressLatestLineWins(host, translator);
    console.log("TRANSLATION_SMOKE_OK");
  } catch (error) {
    console.error("TRANSLATION_SMOKE_FAILED", error);
    process.exitCode = 1;
  } finally {
    await host?.close();
    if (process.exitCode) app.exit(process.exitCode);
    else app.quit();
  }
}

async function stressLatestLineWins(host, translator) {
  const requests = [];
  requests.push(settle(host.translate("Questa richiesta sarà annullata", "Italian", "English")));
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (let index = 0; index < 24; index += 1) {
    requests.push(settle(host.translate(`Questa è la riga numero ${index}`, "Italian", "English")));
  }
  requests.push(settle(host.translate("Buona notte, amore mio", "Italian", "English")));
  const settled = await Promise.all(requests);
  const completed = settled.filter((entry) => entry.status === "fulfilled");
  const latest = settled.at(-1);
  if (completed.length !== 1 || latest.status !== "fulfilled" || !/good night/i.test(latest.value)) {
    throw new Error(`Latest-line stress test failed: ${JSON.stringify(settled)}`);
  }

  const futureLines = ["Dove sei?", "Torna da me", "Non andare via", "Il sole sorgerà"];
  const prefetchStarted = performance.now();
  await translator.prefetch(futureLines, "it", "en");
  const prefetchMilliseconds = Math.round(performance.now() - prefetchStarted);
  const displayStarted = performance.now();
  for (const line of futureLines) await translator.translate(line, "it", "en");
  const cachedDisplayMilliseconds = Math.round(performance.now() - displayStarted);
  if (cachedDisplayMilliseconds > 100) throw new Error(`Cached lines took ${cachedDisplayMilliseconds}ms to display`);
  console.log(`STRESS_RESULT latest-only=ok prefetch=${prefetchMilliseconds}ms cached-display=${cachedDisplayMilliseconds}ms`);
}

function settle(promise) {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason: reason.message })
  );
}
