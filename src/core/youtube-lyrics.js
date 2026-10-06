import { cleanTrackTitle } from "./lrc.js";

const apiRoot = "https://music.youtube.com/youtubei/v1";
let publicApiKey;

export async function findYouTubeMusicLyrics(track, signal, { requestTimeoutMs = 5_000 } = {}) {
  const videoId = await searchVideoId(track, signal, requestTimeoutMs);
  if (!videoId) return null;
  const browseId = await lyricsBrowseId(videoId, signal, requestTimeoutMs);
  if (!browseId) return null;
  const response = await post("browse", {
    context: context("ANDROID_MUSIC", "7.21.50"),
    browseId
  }, signal, requestTimeoutMs);
  const timedLyrics = collectByKey(response, "timedLyricsData")
    .find((value) => Array.isArray(value) && value.length);
  if (!timedLyrics) return null;
  const lines = timedLyrics.map((entry) => ({
    time: Number(entry?.cueRange?.startTimeMilliseconds) / 1000,
    text: String(entry?.lyricLine || "").trim()
  })).filter((line) => Number.isFinite(line.time) && line.text)
    .sort((left, right) => left.time - right.time);
  return lines.length ? { id: videoId, instrumental: false, lines, source: "YouTube Music" } : null;
}

async function searchVideoId(track, signal, timeoutMs) {
  const response = await post("search", {
    context: context("WEB_REMIX", "1.20240101.01.00"),
    query: `${cleanTrackTitle(track.title)} ${track.artist}`.trim(),
    params: "EgWKAQIIAWoMEA4QChADEAQQCRAF"
  }, signal, timeoutMs);
  const candidates = collectByKey(response, "musicResponsiveListItemRenderer")
    .slice(0, 8)
    .map(parseCandidate)
    .filter((candidate) => candidate.videoId);
  let best = null;
  for (const candidate of candidates) {
    candidate.score = scoreCandidate(candidate, track);
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best?.score >= 5 ? best.videoId : null;
}

async function lyricsBrowseId(videoId, signal, timeoutMs) {
  const response = await post("next", {
    context: context("WEB_REMIX", "1.20240101.01.00"),
    videoId
  }, signal, timeoutMs);
  for (const endpoint of collectByKey(response, "browseEndpoint")) {
    const pageType = endpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType;
    if (pageType === "MUSIC_PAGE_TYPE_TRACK_LYRICS" && endpoint.browseId) return endpoint.browseId;
  }
  return null;
}

function parseCandidate(item) {
  const columns = (item?.flexColumns || []).map((column) =>
    column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []);
  const title = columns[0]?.[0]?.text || "";
  const details = columns[1] || [];
  const artists = [];
  let album = "";
  let duration = 0;
  for (const run of details) {
    const endpoint = run?.navigationEndpoint?.browseEndpoint;
    const pageType = endpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType || "";
    if (pageType === "MUSIC_PAGE_TYPE_ARTIST" || /^(UC|FVC)/.test(endpoint?.browseId || "")) {
      artists.push(run.text);
    } else if (pageType === "MUSIC_PAGE_TYPE_ALBUM" || (endpoint?.browseId || "").startsWith("MPRE")) {
      album = run.text;
    } else if (/^\d+:\d+(?::\d+)?$/.test(run?.text || "")) {
      duration = parseDuration(run.text);
    }
  }
  const videoId = item?.playlistItemData?.videoId
    || collectByKey(item, "videoId").find(Boolean)
    || "";
  return { videoId, title, artists, album, duration, score: 0 };
}

function scoreCandidate(candidate, track) {
  const wantedTitle = normalize(cleanTrackTitle(track.title));
  const title = normalize(cleanTrackTitle(candidate.title));
  let score = title === wantedTitle ? 4 : containsEither(title, wantedTitle) ? 2 : 0;
  const wantedArtist = normalize(track.artist);
  if (candidate.artists.some((artist) => containsEither(normalize(artist), wantedArtist))) score += 3;
  const wantedAlbum = normalize(track.album);
  const album = normalize(candidate.album);
  if (wantedAlbum && album) score += album === wantedAlbum ? 2 : containsEither(album, wantedAlbum) ? 1 : 0;
  if (track.duration && candidate.duration) {
    const difference = Math.abs(track.duration - candidate.duration);
    if (difference <= 3) score += 3;
    else if (difference <= 10) score += 2;
    else if (difference <= 20) score += 1;
    else score -= 3;
  }
  return score;
}

async function post(endpoint, body, signal, timeoutMs) {
  const apiKey = await getPublicApiKey(signal, timeoutMs);
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`${apiRoot}/${endpoint}?alt=json&key=${apiKey}`, {
    method: "POST",
    signal: requestSignal,
    redirect: "error",
    headers: { "Content-Type": "application/json", "User-Agent": "LiveMusicTranslator/0.1" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`YouTube Music lyrics returned ${response.status}`);
  const text = await response.text();
  if (text.length > 1_048_576) throw new Error("YouTube Music lyrics response was too large");
  return JSON.parse(text);
}

async function getPublicApiKey(signal, timeoutMs) {
  if (publicApiKey) return publicApiKey;
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch("https://music.youtube.com/", {
    signal: requestSignal,
    redirect: "error",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!response.ok) throw new Error(`YouTube Music page returned ${response.status}`);
  const html = await response.text();
  const match = html.match(/["']INNERTUBE_API_KEY["']\s*:\s*["']([^"']+)["']/);
  if (!match) throw new Error("YouTube Music public API configuration was not found");
  publicApiKey = match[1];
  return publicApiKey;
}

function context(clientName, clientVersion) {
  return { client: { clientName, clientVersion } };
}

function collectByKey(value, key, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Object.hasOwn(value, key)) output.push(value[key]);
  for (const child of Object.values(value)) collectByKey(child, key, output);
  return output;
}

function parseDuration(value) {
  return value.split(":").map(Number).reduce((total, part) => total * 60 + part, 0);
}

function normalize(value = "") {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

function containsEither(left, right) {
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}
