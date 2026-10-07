# Live Music Translator

An always-on-top, line-by-line lyrics translator for language learning. Live Music Translator follows the song playing on your computer, finds synchronized lyrics, detects their language, and shows the current line with an offline translation underneath.

[![License: MIT](https://img.shields.io/badge/License-MIT-72a4f2.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-111827?logo=apple)](#platform-support)
[![Windows](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows11)](#platform-support)
[![Linux](https://img.shields.io/badge/Linux-x64%20%7C%20ARM64-FCC624?logo=linux&logoColor=111827)](#platform-support)

## Screenshot

![Live Music Translator showing synchronized Italian lyrics with an English translation](docs/screenshot.png)

## Download

[**Download the latest release for macOS, Windows, or Linux →**](https://github.com/danl12353231/live-music-translator/releases/latest)

| Platform | Release build |
| --- | --- |
| macOS | Apple silicon (`macos-arm64`) |
| Windows | Windows 10/11 x64 installer (`windows-x64`) |
| Linux | x64 AppImage (`linux-x64`) |

Installers are direct downloads and do not need to be reassembled. On first launch, the app automatically downloads and verifies the 2.59 GB Gemma model once from this repository's dedicated model release, with the upstream Hugging Face file as a fallback. Translation stays local after that.

The macOS build is Developer ID signed but not notarized, and Windows is currently unsigned. macOS Gatekeeper or Windows SmartScreen may ask you to approve the application manually.

## Features

- Shows only the lyric line currently being sung—never a wall of lyrics.
- Displays the original lyric and a target-language translation together.
- Detects the lyric language automatically.
- Works with system media sessions instead of being tied to one music player.
- Uses YouTube Music timed lyrics with LRCLIB as a concurrent fallback.
- Runs translation locally with Gemma 4 E2B and native LiteRT-LM GPU acceleration.
- Downloads the model automatically on first launch, then preloads it on later launches. Music detection does not start until the local translator is ready.
- Cancels obsolete requests and pre-translates upcoming lines for instant display.
- Captures no microphone or system audio.

## How it works

```text
System media session
        │
        ▼
Track metadata ──► YouTube Music / LRCLIB ──► synchronized lyric lines
                                                        │
                                                        ▼
                                         language detection + timing
                                                        │
                                                        ▼
                                native Gemma translation + look-ahead cache
                                                        │
                                                        ▼
                                            always-on-top Electron overlay
```

## Technology

| Area | Technology |
| --- | --- |
| Desktop application | Electron, Node.js, HTML, CSS, JavaScript |
| Local translation | Gemma 4 E2B (`gemma-4-E2B-it.litertlm`) |
| Native inference | LiteRT-LM C API with a small C++17 sidecar |
| Acceleration | Native GPU backend with automatic CPU fallback |
| Language detection | `franc-min` |
| Timed lyrics | YouTube Music web endpoints, LRCLIB fallback, LRC parsing |
| macOS playback | MediaRemote Now Playing, Apple Music and Spotify fallbacks |
| Windows playback | Global System Media Transport Controls via PowerShell/WinRT |
| Linux playback | MPRIS through `playerctl` |
| Packaging | Electron Builder |
| Testing | Node.js test runner plus native GPU smoke/stress tests |

## Platform support

- **macOS:** Apple silicon. Reads the system-wide Now Playing session, including compatible browsers and third-party players.
- **Windows 10/11:** x64. Reads players and browsers that publish a Windows system media session.
- **Linux:** x64 and ARM64. Reads MPRIS-compatible players and browsers; `playerctl` must be installed.

The native LiteRT-LM SDK currently determines the supported CPU/OS combinations.

## Quick start

### Requirements

- Node.js 20 or newer
- Around 3.1 GB of free disk space for the model and build files
- A C++17 compiler:
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools 2022 with C++ support
  - Linux: GCC/G++
- Linux only: `playerctl`

```bash
npm install
npm start
```

The first run downloads and verifies the pinned 2.59 GB Gemma model. The native LiteRT-LM SDK is downloaded at build time so the platform helper can be compiled and included with the app.

## Usage

1. Start Live Music Translator. On the first launch, keep it open while the verified model downloads. Music detection begins only after the model has downloaded and preloaded successfully.
2. Play a song in any player that publishes system media metadata.
3. Open the gear menu and choose the language you understand.
4. Adjust timing in 0.25-second increments if a recording is slightly early or late.

For example, when learning Italian, play an Italian song and select English. The overlay shows each Italian line with its English translation as it is sung.

## Tests

```bash
npm test
npm run smoke:translation
```

The unit suite covers lyric parsing and matching, playback adapters, model integrity, translation caching, cancellation, and YouTube Music timed-lyric parsing. The smoke test loads the real native model and verifies GPU translation, latest-line cancellation, look-ahead prefetch, and cached display latency.

## Build installers

```bash
npm run dist
```

Electron Builder creates installers for the current platform in `dist/`. Build on macOS, Windows, and Linux separately for native releases. The model is stored in the user's application-data directory after the first launch rather than bundled into each installer.

Model and SDK downloads are pinned by exact byte size and SHA-256 checksum in the build scripts. Generated models, SDK files, installers, and native binaries are excluded from Git.

## Privacy and network access

- Translation is performed locally. Lyric text is not sent to a translation API.
- The verified Gemma model is downloaded once from this repository's GitHub model release on first launch, with Hugging Face as a fallback.
- The application does not listen to or record audio.
- Track title, artist, album, and duration are sent to YouTube Music and LRCLIB to locate synchronized lyrics.
- Lyrics are held in application memory and are not committed to this repository.

YouTube Music's web endpoints are unofficial and may change. Live Music Translator is not affiliated with Google, YouTube, LRCLIB, Spotify, Apple, or Microsoft.

## Project structure

```text
native/                 C++ LiteRT-LM translation helper
scripts/                verified model/SDK preparation and smoke tests
src/core/               lyrics, language detection, translation and caching
src/playback/           macOS, Windows and Linux media-session adapters
src/renderer/           secure always-on-top overlay UI
src/translation/        native helper process host
test/                   dependency-light unit tests
```

## License

The application source is available under the [MIT License](LICENSE). Third-party runtimes, models, services, and generated artifacts retain their own licenses and terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Support

If Live Music Translator helps with your language learning, you can support continued development:

<a href="https://ko-fi.com/U2P428BPKQ" target="_blank"><img src="https://storage.ko-fi.com/cdn/kofi5.png?v=3" alt="Support me on Ko-fi" height="44"></a>

GitHub sanitizes executable `<script>` tags in README files, so the Ko-fi widget is represented by the official clickable Ko-fi image instead.
