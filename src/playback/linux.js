import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const separator = "␟";
const format = ["{{playerName}}", "{{title}}", "{{artist}}", "{{album}}", "{{mpris:length}}", "{{position}}", "{{status}}"].join(separator);

export async function readLinuxPlayback() {
  try {
    const { stdout } = await execFileAsync("playerctl", ["-a", "metadata", "--format", format], { timeout: 2500 });
    const rows = parseLinuxPlaybackRows(stdout);
    return rows.find((row) => row?.playing) ?? rows[0] ?? null;
  } catch {
    return null;
  }
}

export function parseLinuxPlaybackRows(stdout, sampledAt = Date.now()) {
  return stdout.trim().split("\n").filter(Boolean).map((row) => parse(row, sampledAt)).filter(Boolean);
}

function parse(value, sampledAt) {
  const [player, title, artist, album, duration, position, state] = value.split(separator);
  if (!title || !artist) return null;
  return {
    player, title, artist, album,
    duration: (Number(duration) || 0) / 1_000_000,
    position: (Number(position) || 0) / 1_000_000,
    playing: state?.trim().toLowerCase() === "playing",
    sampledAt
  };
}
