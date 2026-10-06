import test from "node:test";
import assert from "node:assert/strict";
import { LatestTaskQueue } from "../src/core/latest-task-queue.js";

test("latest task queue cancels active and queued work so only the newest request runs", async () => {
  const started = [];
  let active = 0;
  let maximumActive = 0;
  const queue = new LatestTaskQueue((value, signal) => new Promise((resolve, reject) => {
    started.push(value);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    const finish = () => { active -= 1; };
    signal.addEventListener("abort", () => {
      finish();
      reject(signal.reason);
    }, { once: true });
    if (value === 3) {
      finish();
      resolve("latest");
    }
  }));

  const first = queue.submit(1);
  await Promise.resolve();
  const second = queue.submit(2);
  const third = queue.submit(3);

  await assert.rejects(first, /superseded/);
  await assert.rejects(second, /superseded/);
  assert.equal(await third, "latest");
  assert.deepEqual(started, [1, 3]);
  assert.equal(maximumActive, 1);
});
