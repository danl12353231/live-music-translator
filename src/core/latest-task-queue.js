export class SupersededError extends Error {
  constructor(message = "Translation superseded by a newer lyric line") {
    super(message);
    this.name = "AbortError";
  }
}

export class LatestTaskQueue {
  constructor(execute, onCancelActive = () => {}) {
    this.execute = execute;
    this.onCancelActive = onCancelActive;
    this.queued = null;
    this.active = null;
    this.draining = false;
  }

  submit(value) {
    this.cancel(new SupersededError());
    const controller = new AbortController();
    const promise = new Promise((resolve, reject) => {
      this.queued = { value, resolve, reject, controller, settled: false };
    });
    void this.drain();
    return promise;
  }

  cancel(error = new SupersededError("Translation cancelled")) {
    if (this.queued) {
      this.abort(this.queued, error);
      this.queued = null;
    }
    if (this.active) {
      this.abort(this.active, error);
      this.onCancelActive();
    }
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queued) {
        const entry = this.queued;
        this.queued = null;
        this.active = entry;
        try {
          const value = await this.execute(entry.value, entry.controller.signal);
          this.settle(entry, "resolve", value);
        } catch (error) {
          this.settle(entry, "reject", error);
        } finally {
          if (this.active === entry) this.active = null;
        }
      }
    } finally {
      this.draining = false;
      if (this.queued) void this.drain();
    }
  }

  abort(entry, error) {
    entry.controller.abort(error);
    this.settle(entry, "reject", error);
  }

  settle(entry, method, value) {
    if (entry.settled) return;
    entry.settled = true;
    entry[method](value);
  }
}
