import test from "node:test";
import assert from "node:assert/strict";
import { findSyncedLyrics } from "../src/core/lyrics-client.js";

test("falls back to broad search when an exact lyric lookup fails", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes("/get?")) return new Response("unavailable", { status: 503 });
    return Response.json([{
      id: 7,
      duration: 185,
      syncedLyrics: "[00:00.25]Ciao\n[00:03.00]Mondo"
    }]);
  };

  const result = await findSyncedLyrics({
    title: "Example", artist: "Singer", album: "Different release", duration: 185
  }, undefined, { youtube: false });

  assert.equal(requested.length, 2);
  assert.match(requested[1], /\/search\?/);
  assert.deepEqual(result.lines, [
    { time: 0.25, text: "Ciao" },
    { time: 3, text: "Mondo" }
  ]);
});

test("times out a stalled exact lookup and reaches the broad search fallback", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const keepAlive = setTimeout(() => {}, 100);
  context.after(() => clearTimeout(keepAlive));
  const requested = [];
  globalThis.fetch = (url, options) => {
    requested.push(String(url));
    if (String(url).includes("/search?")) {
      return Promise.resolve(Response.json([{
        id: 8,
        duration: 198,
        syncedLyrics: "[00:01.00]I feel it coming"
      }]));
    }
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    });
  };

  const result = await findSyncedLyrics({
    title: "Silverlines - prod. Labrinth",
    artist: "Damiano David",
    album: "FUNNY little FEARS",
    duration: 198
  }, undefined, { requestTimeoutMs: 20, youtube: false });

  assert.equal(requested.length, 2);
  assert.equal(result.lines[0].text, "I feel it coming");
});
