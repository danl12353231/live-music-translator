import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModelManager } from "../src/core/model-manager.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let lastPercent = -1;
const manager = new ModelManager(path.join(root, "models"), {
  onStatus(status) {
    if (status.phase !== "downloading") return;
    const percent = Math.floor(status.progress * 100);
    if (percent !== lastPercent) {
      lastPercent = percent;
      process.stdout.write(`Gemma model: ${percent}%\n`);
    }
  }
});

await manager.download();
process.stdout.write(`Gemma model ready: ${manager.modelPath}\n`);
