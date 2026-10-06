const timestampPattern = /\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g;

export function parseLRC(text) {
  if (!text) return [];

  const lines = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(timestampPattern)];
    if (!timestamps.length) continue;

    const lyric = rawLine.replace(timestampPattern, "").trim();
    if (!lyric || /^\[(ar|al|ti|by|offset):/i.test(rawLine)) continue;

    for (const match of timestamps) {
      const seconds = Number(match[1]) * 60 + Number(match[2]);
      if (Number.isFinite(seconds)) lines.push({ time: seconds, text: lyric });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

export function activeLineIndex(lines, positionSeconds, offsetSeconds = 0) {
  const adjusted = positionSeconds + offsetSeconds;
  let low = 0;
  let high = lines.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].time <= adjusted) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

export function cleanTrackTitle(title = "") {
  return title
    .replace(/\s*[([](?:feat\.?|ft\.?|with)\s+[^\])]+[\])]/gi, "")
    .replace(/\s*[([](?:live|remaster(?:ed)?(?:\s+\d{4})?|radio edit|single version)[^\])]*[\])]/gi, "")
    .replace(/\s+-\s+(?:remaster(?:ed)?|live|radio edit|single version).*$/gi, "")
    .trim();
}
