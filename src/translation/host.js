import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

export class LocalTranslationHost {
  constructor({ helperPath, modelPath, cachePath, onStatus = () => {} }) {
    this.helperPath = helperPath;
    this.modelPath = modelPath;
    this.cachePath = cachePath;
    this.onStatus = onStatus;
    this.pending = new Map();
    this.nextId = 1;
    this.phase = "installed";
    this.stderr = [];
  }

  async initialize() {
    if (this.closing) throw new Error("Native translator is shutting down");
    if (this.phase === "ready" && this.child && !this.child.killed) return;
    if (this.initializePromise) return this.initializePromise;
    this.phase = "loading";
    this.onStatus({ phase: "loading", message: "Preloading Gemma in the native GPU runtime…" });
    this.initializePromise = this.startWithFallback().finally(() => { this.initializePromise = null; });
    return this.initializePromise;
  }

  async startWithFallback() {
    try {
      await this.start("gpu");
    } catch (gpuError) {
      await this.stopChild();
      if (this.closing) throw new Error("Native translator is shutting down");
      this.onStatus({ phase: "loading", message: "GPU unavailable — loading the native CPU runtime…" });
      try {
        await this.start("cpu");
      } catch (cpuError) {
        this.phase = "error";
        const error = new Error(`Native translator could not start: ${cpuError.message || gpuError.message}`);
        this.onStatus({ phase: "error", message: error.message });
        throw error;
      }
    }
    this.phase = "ready";
    this.onStatus({
      phase: "ready",
      progress: 1,
      backend: this.backend,
      message: `Gemma is preloaded in the native ${this.backend.toUpperCase()} runtime`
    });
  }

  async start(backend) {
    if (this.closing) throw new Error("Native translator is shutting down");
    await mkdir(this.cachePath, { recursive: true });
    this.backend = backend;
    this.stderr = [];
    const directory = path.dirname(this.helperPath);
    const env = { ...process.env };
    env.DYLD_LIBRARY_PATH = prependPath(directory, env.DYLD_LIBRARY_PATH);
    env.LD_LIBRARY_PATH = prependPath(directory, env.LD_LIBRARY_PATH);
    env.PATH = prependPath(directory, env.PATH);
    this.child = spawn(this.helperPath, [
      "--model", this.modelPath,
      "--backend", backend,
      "--cache", this.cachePath
    ], {
      cwd: directory,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr.push(chunk);
      if (this.stderr.length > 30) this.stderr.shift();
    });
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.receiveLine(line));
    this.child.once("error", (error) => this.startReject?.(error));
    this.child.once("exit", (code, signal) => this.onExit(code, signal));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Native model preload timed out")), 180_000);
      this.startResolve = () => { clearTimeout(timer); resolve(); };
      this.startReject = (error) => { clearTimeout(timer); reject(error); };
    });
    this.startResolve = this.startReject = null;
  }

  async translate(text, sourceName, targetName) {
    await this.initialize();
    this.cancel();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.write({ type: "cancel" });
        reject(new Error(`Native translation ${id} timed out`));
      }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ type: "translate", id, text, source: sourceName, target: targetName });
    });
  }

  cancel() {
    this.rejectAll(new Error("Translation cancelled by a newer lyric line"));
    this.write({ type: "cancel" });
  }

  async close() {
    this.closing = true;
    this.rejectAll(new Error("Native translator stopped"));
    await this.stopChild();
    try {
      await this.initializePromise;
    } catch {
      // Initialization rejects when shutdown interrupts model preloading.
    }
    await this.stopChild();
  }

  receiveLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.type === "ready") {
      this.startResolve?.();
      return;
    }
    if (message.type === "fatal") {
      this.startReject?.(new Error(message.error || "Native translator failed"));
      return;
    }
    if (message.type !== "result") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) return pending.reject(new Error(message.error));
    const translation = extractText(message.response);
    if (!translation) return pending.reject(new Error("Gemma returned an empty translation"));
    pending.resolve(cleanOutput(translation));
  }

  onExit(code, signal) {
    const details = this.stderr.join("").trim().split("\n").at(-1);
    const error = new Error(details || `Native translator exited (${signal || code})`);
    this.startReject?.(error);
    this.rejectAll(error);
    this.child = null;
    if (!this.closing && this.phase === "ready") {
      this.phase = "error";
      this.onStatus({ phase: "error", message: "Native translator stopped unexpectedly" });
    }
  }

  write(message) {
    if (this.child?.stdin?.writable) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async stopChild() {
    const child = this.child;
    if (!child) return;
    this.write({ type: "shutdown" });
    if (child.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 1500))
      ]);
    }
    if (child.exitCode === null && !child.killed) child.kill();
    this.lines?.close();
    if (this.child === child) this.child = null;
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function extractText(response) {
  if (typeof response?.content === "string") return response.content;
  if (!Array.isArray(response?.content)) return "";
  return response.content.find((part) => part?.type === "text")?.text || "";
}

function cleanOutput(value) {
  return value
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^translation\s*:\s*/i, "")
    .replace(/^(["'])([\s\S]*)\1$/, "$2")
    .trim();
}

function prependPath(value, existing = "") {
  return existing ? `${value}${path.delimiter}${existing}` : value;
}
