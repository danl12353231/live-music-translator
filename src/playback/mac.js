import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const separator = "␟";

// macOS has no public API for reading another app's Now Playing session. This
// JXA bridge reads the same system session shown in Control Center and catches
// browsers and third-party players; the app-specific script below is a stable
// fallback for Apple Music and Spotify.
const systemNowPlayingScript = `
ObjC.import('Foundation');
function run() {
  const framework = $.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/MediaRemote.framework/');
  framework.load;
  const Request = $.NSClassFromString('MRNowPlayingRequest');
  if (!Request) return '';
  const item = Request.localNowPlayingItem;
  if (!item) return '';
  const info = item.nowPlayingInfo;
  if (!info) return '';
  function value(key) {
    const raw = info.valueForKey(key);
    return raw ? ObjC.unwrap(raw) : null;
  }
  const title = value('kMRMediaRemoteNowPlayingInfoTitle');
  const artist = value('kMRMediaRemoteNowPlayingInfoArtist');
  if (!title || !artist) return '';
  const playerPath = Request.localNowPlayingPlayerPath;
  const player = playerPath && playerPath.client ? ObjC.unwrap(playerPath.client.displayName) : 'macOS Now Playing';
  const metadata = item.metadata;
  const calculated = metadata ? ObjC.unwrap(metadata.calculatedPlaybackPosition) : null;
  return JSON.stringify({
    player: player,
    title: title,
    artist: artist,
    album: value('kMRMediaRemoteNowPlayingInfoAlbum') || '',
    duration: Number(value('kMRMediaRemoteNowPlayingInfoDuration')) || 0,
    position: Number(calculated != null ? calculated : value('kMRMediaRemoteNowPlayingInfoElapsedTime')) || 0,
    playing: Number(value('kMRMediaRemoteNowPlayingInfoPlaybackRate')) > 0
  });
}
`;

const script = `
set sep to "${separator}"
if application "Spotify" is running then
  tell application "Spotify"
    if player state is playing or player state is paused then
      set t to current track
      return "Spotify" & sep & (name of t) & sep & (artist of t) & sep & (album of t) & sep & ((duration of t) / 1000) & sep & player position & sep & (player state as text)
    end if
  end tell
end if
if application "Music" is running then
  tell application "Music"
    if player state is playing or player state is paused then
      set t to current track
      return "Apple Music" & sep & (name of t) & sep & (artist of t) & sep & (album of t) & sep & (duration of t) & sep & player position & sep & (player state as text)
    end if
  end tell
end if
return ""
`;

export async function readMacPlayback() {
  const systemTrack = await readSystemNowPlaying();
  if (systemTrack) return systemTrack;
  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], { timeout: 2500 });
    return parse(stdout.trim());
  } catch {
    return null;
  }
}

async function readSystemNowPlaying() {
  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", systemNowPlayingScript], { timeout: 2500 });
    if (!stdout.trim()) return null;
    const track = JSON.parse(stdout.trim());
    return { ...track, sampledAt: Date.now() };
  } catch {
    return null;
  }
}

function parse(value) {
  if (!value) return null;
  const [player, title, artist, album, duration, position, state] = value.split(separator);
  if (!title || !artist) return null;
  return {
    player, title, artist, album,
    duration: Number(duration) || 0,
    position: Number(position) || 0,
    playing: state?.trim().toLowerCase() === "playing",
    sampledAt: Date.now()
  };
}
