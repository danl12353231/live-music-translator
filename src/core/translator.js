export class Translator {
  constructor(engine) {
    this.engine = engine;
    this.cache = new Map();
    this.inflight = new Map();
    this.prefetchGeneration = 0;
  }

  async translate(text, source, target, { background = false } = {}) {
    if (!text || source === target || target === "none") return Promise.resolve(text);
    const key = `${source}\u0000${target}\u0000${text}`;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (!background) {
      this.prefetchGeneration += 1;
      this.engine.cancel?.();
    }
    const request = this.engine.translate(text, languageName(source), languageName(target))
      .then((translation) => {
        this.cache.set(key, translation);
        return translation;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  async prefetch(texts, source, target) {
    const generation = this.prefetchGeneration;
    for (const text of [...new Set(texts)].filter(Boolean)) {
      if (generation !== this.prefetchGeneration) return;
      try {
        await this.translate(text, source, target, { background: true });
      } catch {
        if (generation !== this.prefetchGeneration) return;
        return;
      }
    }
  }

  cancel() {
    this.prefetchGeneration += 1;
    this.engine.cancel?.();
  }

  clear() {
    this.cancel();
    this.cache.clear();
    this.inflight.clear();
  }
}

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

function languageName(code) {
  if (!code || code === "und") return "the source language";
  return languageNames.of(code) || code;
}
