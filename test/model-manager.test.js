import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelManager } from "../src/core/model-manager.js";

test("model manager verifies and atomically installs a download", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lingua-model-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const content = Buffer.from("small fake model for a deterministic unit test");
  const model = {
    name: "Test model",
    fileName: "test.litertlm",
    size: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    url: "https://example.test/model"
  };
  const phases = [];
  const manager = new ModelManager(directory, {
    model,
    fetchImpl: async () => new Response(content, { headers: { "content-length": String(content.length) } }),
    onStatus: (status) => phases.push(status.phase)
  });

  assert.equal((await manager.check()).phase, "not-installed");
  await manager.download();
  assert.deepEqual(await readFile(manager.modelPath), content);
  assert.equal(manager.status().phase, "installed");
  assert.ok(phases.includes("downloading"));
});

test("model manager rejects a model with the wrong checksum", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lingua-model-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const content = Buffer.from("bad model");
  const manager = new ModelManager(directory, {
    model: { name: "Test", fileName: "bad.litertlm", size: content.length, sha256: "0".repeat(64), url: "https://example.test/model" },
    fetchImpl: async () => new Response(content, { headers: { "content-length": String(content.length) } })
  });

  await assert.rejects(() => manager.download(), /checksum/);
  assert.equal(manager.status().phase, "error");
});
