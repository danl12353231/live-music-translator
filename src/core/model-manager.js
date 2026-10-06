import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, stat, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const GEMMA_MODEL = Object.freeze({
  name: "Gemma 4 E2B",
  fileName: "gemma-4-E2B-it.litertlm",
  size: 2_588_147_712,
  sha256: "181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c",
  url: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm",
  downloads: [
    {
      name: "GitHub",
      parts: [
        {
          url: "https://github.com/danl12353231/live-music-translator/releases/download/model-gemma-4-e2b-v1/gemma-4-E2B-it.litertlm.part-01",
          size: 1_300_000_000
        },
        {
          url: "https://github.com/danl12353231/live-music-translator/releases/download/model-gemma-4-e2b-v1/gemma-4-E2B-it.litertlm.part-02",
          size: 1_288_147_712
        }
      ]
    },
    {
      name: "Hugging Face fallback",
      parts: [{
        url: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm",
        size: 2_588_147_712
      }]
    }
  ]
});

export class ModelManager {
  constructor(directory, { model = GEMMA_MODEL, bundledPath, fetchImpl = globalThis.fetch, onStatus = () => {} } = {}) {
    this.directory = directory;
    this.model = model;
    this.bundledPath = bundledPath;
    this.activePath = null;
    this.fetchImpl = fetchImpl;
    this.onStatus = onStatus;
    this.current = { phase: "checking", progress: 0, downloaded: 0, total: model.size, message: "Checking local model…" };
    this.downloadPromise = null;
  }

  get modelPath() {
    return this.activePath || this.localModelPath;
  }

  get localModelPath() {
    return path.join(this.directory, this.model.fileName);
  }

  status() {
    return { ...this.current, model: this.model.name, size: this.model.size };
  }

  async check() {
    for (const candidate of [this.bundledPath, this.localModelPath].filter(Boolean)) {
      try {
        const info = await stat(candidate);
        if (info.isFile() && info.size === this.model.size) {
          this.activePath = candidate;
          const bundled = candidate === this.bundledPath;
          return this.update({
            phase: "installed", progress: 1, downloaded: this.model.size,
            bundled, message: bundled ? "Gemma is included with the app" : "Gemma is installed"
          });
        }
      } catch { /* Keep checking candidates. */ }
    }
    this.activePath = null;
    return this.update({ phase: "not-installed", progress: 0, downloaded: 0, message: "Local translator not installed" });
  }

  async download() {
    if (this.downloadPromise) return this.downloadPromise;
    this.downloadPromise = (async () => {
      if ((await this.check()).phase === "installed") {
        if (await fileSha256(this.modelPath) === this.model.sha256) return this.modelPath;
        if (this.modelPath !== this.localModelPath) throw new Error("The bundled Gemma model failed checksum verification");
        await safeUnlink(this.localModelPath);
        this.activePath = null;
      }
      return this.downloadModel();
    })().finally(() => { this.downloadPromise = null; });
    return this.downloadPromise;
  }

  async downloadModel() {
    await mkdir(this.directory, { recursive: true });
    const disk = await statfs(this.directory);
    const freeBytes = Number(disk.bavail) * Number(disk.bsize);
    if (freeBytes < this.model.size + 500_000_000) {
      const error = new Error("At least 3.1 GB of free disk space is required");
      this.update({ phase: "error", message: error.message });
      throw error;
    }

    const partialPath = `${this.localModelPath}.part`;
    const downloads = this.model.downloads || [{
      name: "model host",
      parts: [{ url: this.model.url, size: this.model.size }]
    }];
    let lastError;
    for (const download of downloads) {
      await safeUnlink(partialPath);
      try {
        const { downloaded, sha256 } = await this.downloadFrom(download, partialPath);
        if (downloaded !== this.model.size) throw new Error("The model download is incomplete");
        if (sha256 !== this.model.sha256) throw new Error("The model checksum did not match");
        await safeUnlink(this.localModelPath);
        await rename(partialPath, this.localModelPath);
        this.activePath = this.localModelPath;
        this.update({ phase: "installed", progress: 1, downloaded, message: "Gemma is installed" });
        return this.localModelPath;
      } catch (error) {
        lastError = error;
        await safeUnlink(partialPath);
      }
    }
    this.update({ phase: "error", message: lastError?.message || "Model download failed" });
    throw lastError || new Error("Model download failed");
  }

  async downloadFrom(download, destination) {
    const output = await open(destination, "wx");
    const hash = createHash("sha256");
    let downloaded = 0;
    let lastNotice = 0;
    this.update({ phase: "downloading", progress: 0, downloaded: 0, message: `Downloading Gemma from ${download.name}…` });
    try {
      for (const part of download.parts) {
        const response = await this.fetchImpl(part.url, { redirect: "follow" });
        if (!response.ok || !response.body) throw new Error(`Model download failed (HTTP ${response.status})`);
        const declaredSize = Number(response.headers.get("content-length"));
        if (declaredSize && declaredSize !== part.size) throw new Error("A model download part has an unexpected size");
        let partBytes = 0;
        for await (const chunk of Readable.fromWeb(response.body)) {
          await output.write(chunk);
          partBytes += chunk.length;
          downloaded += chunk.length;
          hash.update(chunk);
          const now = Date.now();
          if (now - lastNotice >= 250 || downloaded === this.model.size) {
            lastNotice = now;
            this.update({
              phase: "downloading",
              downloaded,
              progress: Math.min(1, downloaded / this.model.size),
              message: `Downloading Gemma from ${download.name}… ${formatBytes(downloaded)} of ${formatBytes(this.model.size)}`
            });
          }
        }
        if (partBytes !== part.size) throw new Error("A model download part is incomplete");
      }
    } finally {
      await output.close();
    }
    return { downloaded, sha256: hash.digest("hex") };
  }

  update(patch) {
    this.current = { ...this.current, ...patch, total: this.model.size };
    this.onStatus(this.status());
    return this.status();
  }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

async function safeUnlink(file) {
  try { await unlink(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

async function fileSha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
