import test from "node:test";
import assert from "node:assert/strict";
import { parseLinuxPlaybackRows } from "../src/playback/linux.js";
import { externalFilePath, parseWindowsPlaybackOutput } from "../src/playback/windows.js";

const separator = "␟";

test("Linux adapter converts MPRIS microseconds and preserves Unicode metadata", () => {
  const output = [
    ["spotify", "Paused song", "Artist", "Album", "180000000", "12000000", "Paused"].join(separator),
    ["vlc", "È così", "L'artista", "Raccolta", "205500000", "33750000", "Playing"].join(separator)
  ].join("\n");
  const rows = parseLinuxPlaybackRows(output, 1234);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], {
    player: "vlc", title: "È così", artist: "L'artista", album: "Raccolta",
    duration: 205.5, position: 33.75, playing: true, sampledAt: 1234
  });
});

test("Windows adapter accepts UTF-8 JSON with an optional BOM", () => {
  const output = '\uFEFF{"player":"Spotify.exe","title":"Città","artist":"Måneskin","playing":true}';
  assert.deepEqual(parseWindowsPlaybackOutput(output), {
    player: "Spotify.exe", title: "Città", artist: "Måneskin", playing: true
  });
});

test("external Windows helper resolves outside the ASAR archive", () => {
  const input = ["C:", "App", "resources", "app.asar", "src", "playback", "helper.ps1"].join("/");
  const expected = input.replace("/app.asar/", "/app.asar.unpacked/");
  // Use the host separator so this assertion also exercises correctly on CI for each OS.
  const hostInput = input.replaceAll("/", process.platform === "win32" ? "\\" : "/");
  const hostExpected = expected.replaceAll("/", process.platform === "win32" ? "\\" : "/");
  assert.equal(externalFilePath(hostInput), hostExpected);
});
