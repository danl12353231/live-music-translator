import test from "node:test";
import assert from "node:assert/strict";
import { activeLineIndex, cleanTrackTitle, parseLRC } from "../src/core/lrc.js";

test("parses and sorts LRC timestamps, including repeated timestamps", () => {
  const result = parseLRC(`[00:12.50]Second
[00:03.00][00:08.25]First
[ar:Someone]
[00:15.000]Third`);
  assert.deepEqual(result, [
    { time: 3, text: "First" },
    { time: 8.25, text: "First" },
    { time: 12.5, text: "Second" },
    { time: 15, text: "Third" }
  ]);
});

test("finds the active line efficiently and respects timing offset", () => {
  const lines = [{ time: 2 }, { time: 5 }, { time: 9 }];
  assert.equal(activeLineIndex(lines, 1.9), -1);
  assert.equal(activeLineIndex(lines, 5), 1);
  assert.equal(activeLineIndex(lines, 4.8, 0.25), 1);
  assert.equal(activeLineIndex(lines, 9.5, -1), 1);
});

test("normalizes common decorated track titles for lyric lookup", () => {
  assert.equal(cleanTrackTitle("Song (feat. Singer)"), "Song");
  assert.equal(cleanTrackTitle("Song - Remastered 2020"), "Song");
  assert.equal(cleanTrackTitle("Song [Live]"), "Song");
});
