import { cleanTrackTitle, parseLRC } from "./lrc.js";
import { findYouTubeMusicLyrics } from "./youtube-lyrics.js";

const baseURL = "https://lrclib.net/api";

export async function findSyncedLyrics(track, signal, { requestTimeoutMs = 5_000, youtube = true } = {}) {
  const providers = [findLrclibLyrics(track, signal, requestTimeoutMs)];
  if (youtube) providers.unshift(findYouTubeMusicLyrics(track, signal, { requestTimeoutMs }));
  try {
    return await Promise.any(providers.map((provider) => provider.then((result) => {
      if (!result) throw new LyricsNotFoundError();
      return result;
    })));
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    const errors = error instanceof AggregateError ? error.errors : [error];
    if (errors.every((item) => item instanceof LyricsNotFoundError)) return null;
    throw errors.find((item) => item.name === "TimeoutError") || errors[0];
  }
}

async function findLrclibLyrics(track, signal, requestTimeoutMs) {
  const params = new URLSearchParams({
    track_name: cleanTrackTitle(track.title),
    artist_name: track.artist
  });
  if (track.album) params.set("album_name", track.album);
  if (track.duration) params.set("duration", String(Math.round(track.duration)));

  let exact = null;
  try {
    exact = await request(`${baseURL}/get?${params}`, signal, true, 0, requestTimeoutMs);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    // LRCLIB occasionally rejects an over-specific album/duration match even
    // though its broader search endpoint has the correct recording.
  }
  if (exact?.syncedLyrics) return toResult(exact);

  const searchParams = new URLSearchParams({
    track_name: cleanTrackTitle(track.title),
    artist_name: track.artist
  });
  const results = await request(`${baseURL}/search?${searchParams}`, signal, false, 0, requestTimeoutMs);
  const best = Array.isArray(results)
    ? results.find((item) => item.syncedLyrics && durationClose(item.duration, track.duration))
      ?? results.find((item) => item.syncedLyrics)
    : null;
  return best ? toResult(best) : null;
}

class LyricsNotFoundError extends Error {}

async function request(url, signal, allowNotFound = false, retries = 0, timeoutMs = 5_000) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(url, {
    signal: requestSignal,
    headers: { "User-Agent": "LiveMusicTranslator/0.1 (language-learning desktop app)" }
  });
  if (allowNotFound && response.status === 404) return null;
  if ((response.status === 429 || response.status >= 500) && retries > 0) {
    const retryAfter = Number(response.headers.get("retry-after"));
    await abortableDelay(Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * (3 - retries), signal);
    return request(url, signal, allowNotFound, retries - 1, timeoutMs);
  }
  if (!response.ok) throw new Error(`Lyrics service returned ${response.status}`);
  return response.json();
}

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function durationClose(candidate, actual) {
  return !actual || !candidate || Math.abs(candidate - actual) <= 5;
}

function toResult(record) {
  return {
    id: record.id,
    instrumental: Boolean(record.instrumental),
    lines: parseLRC(record.syncedLyrics),
    source: "LRCLIB"
  };
}
