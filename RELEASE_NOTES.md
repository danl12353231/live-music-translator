# Live Music Translator

The first public release of Live Music Translator: an always-on-top, line-by-line lyrics overlay with fully local Gemma translation.

## Download and install

Choose the assets for your platform:

- `macos-arm64` — Apple-silicon macOS
- `windows-x64` — Windows 10/11 x64
- `linux-x64` — x64 Linux

The offline model makes installers larger than GitHub's 2 GiB per-file limit. When an installer is split, download every `.part-*` file for your platform plus its `REASSEMBLE-*.txt` instructions. Join the pieces, then open the reconstructed installer. `SHA256SUMS-*.txt` contains checksums for both the complete installer and its individual parts.

These community builds are not yet code-signed or notarized, so macOS Gatekeeper or Windows SmartScreen may require manual approval.

## Highlights

- Synchronized lyrics from YouTube Music with LRCLIB fallback
- Automatic lyric-language detection
- Native, offline Gemma 4 E2B translation through LiteRT-LM
- GPU acceleration with CPU fallback
- Translation look-ahead caching and latest-line cancellation
- macOS, Windows, and Linux system-media integration
- No microphone or system-audio capture
