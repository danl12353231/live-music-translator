import { readMacPlayback } from "./mac.js";
import { readLinuxPlayback } from "./linux.js";
import { readWindowsPlayback } from "./windows.js";

export async function readPlayback() {
  if (process.platform === "darwin") return readMacPlayback();
  if (process.platform === "win32") return readWindowsPlayback();
  if (process.platform === "linux") return readLinuxPlayback();
  return null;
}

export function trackKey(track) {
  return track ? `${track.artist}\u0000${track.title}\u0000${track.duration ?? ""}` : "";
}
