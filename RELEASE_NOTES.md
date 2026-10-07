# Live Music Translator

Version 0.1.1 fixes first-launch ordering so the verified local translator is fully ready before music monitoring begins.

## Download and install

Choose the assets for your platform:

- `macos-arm64` — Apple-silicon macOS
- `windows-x64` — Windows 10/11 x64 installer
- `linux-x64` — x64 Linux

Each platform is provided as one direct download. On first launch, Live Music Translator automatically downloads and verifies the 2.59 GB Gemma model from the project's dedicated GitHub model release. After that, translation runs locally without a translation service.

The macOS build is Developer ID signed but not notarized. Windows is currently unsigned. macOS Gatekeeper or Windows SmartScreen may therefore require manual approval.

## Highlights

- The model now downloads and preloads before music detection starts
- Synchronized lyrics from YouTube Music with LRCLIB fallback
- Automatic lyric-language detection
- Native, offline Gemma 4 E2B translation through LiteRT-LM
- GPU acceleration with CPU fallback
- Translation look-ahead caching and latest-line cancellation
- macOS, Windows, and Linux system-media integration
- No microphone or system-audio capture
