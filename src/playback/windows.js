import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const scriptPath = externalFilePath(fileURLToPath(new URL("./windows-now-playing.ps1", import.meta.url)));

export async function readWindowsPlayback() {
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath
    ], { timeout: 3500, windowsHide: true });
    const value = parseWindowsPlaybackOutput(stdout);
    if (!value?.title || !value?.artist) return null;
    return { ...value, sampledAt: Date.now() };
  } catch {
    return null;
  }
}

export function parseWindowsPlaybackOutput(stdout) {
  const normalized = stdout.replace(/^\uFEFF/, "").trim();
  return normalized ? JSON.parse(normalized) : null;
}

export function externalFilePath(filePath) {
  const archivedSegment = `${path.sep}app.asar${path.sep}`;
  const unpackedSegment = `${path.sep}app.asar.unpacked${path.sep}`;
  return filePath.replace(archivedSegment, unpackedSegment);
}
