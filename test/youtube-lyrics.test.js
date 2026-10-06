import test from "node:test";
import assert from "node:assert/strict";
import { findYouTubeMusicLyrics } from "../src/core/youtube-lyrics.js";

test("matches a YouTube Music recording and parses synchronized lyric cues", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const endpoints = [];
  globalThis.fetch = async (url) => {
    if (String(url) === "https://music.youtube.com/") {
      return new Response('<script>ytcfg.set({"INNERTUBE_API_KEY":"public-test-key"})</script>');
    }
    const endpoint = new URL(url).pathname.split("/").at(-1);
    endpoints.push(endpoint);
    if (endpoint === "search") return jsonResponse(searchFixture());
    if (endpoint === "next") return jsonResponse({ tabs: [{ browseEndpoint: {
      browseId: "MPLYt_test",
      browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: {
        pageType: "MUSIC_PAGE_TYPE_TRACK_LYRICS"
      } }
    } }] });
    return jsonResponse({ timedLyricsData: [
      { cueRange: { startTimeMilliseconds: "1250" }, lyricLine: "Ciao" },
      { cueRange: { startTimeMilliseconds: 3200 }, lyricLine: "Mondo" }
    ] });
  };

  const result = await findYouTubeMusicLyrics({
    title: "Example Song", artist: "The Singer", album: "Example Album", duration: 185
  });

  assert.deepEqual(endpoints, ["search", "next", "browse"]);
  assert.equal(result.source, "YouTube Music");
  assert.deepEqual(result.lines, [
    { time: 1.25, text: "Ciao" },
    { time: 3.2, text: "Mondo" }
  ]);
});

function searchFixture() {
  const endpoint = (pageType, browseId) => ({ browseEndpoint: {
    browseId,
    browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } }
  } });
  return { musicResponsiveListItemRenderer: {
    playlistItemData: { videoId: "video123" },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Example Song" }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [
        { text: "The Singer", navigationEndpoint: endpoint("MUSIC_PAGE_TYPE_ARTIST", "UC123") },
        { text: "Example Album", navigationEndpoint: endpoint("MUSIC_PAGE_TYPE_ALBUM", "MPRE123") },
        { text: "3:05" }
      ] } } }
    ]
  } };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}
