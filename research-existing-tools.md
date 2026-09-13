# Open Source Tools for DJ Mix Track Identification

Research date: 2026-09-12.

## 1. Summary Table

| Tool | URL | Language | Backend | Last activity | Chunking/timestamps | License | Notes |
|---|---|---|---|---|---|---|---|
| Tracklistify | github.com/betmoar/tracklistify | Python | Shazam + ACRCloud (proprietary) | Active, ~72 stars | Yes, segments + M3U timestamps | MIT | Open source client, proprietary backend. Multi-provider fallback. |
| RipThatSet | github.com/b1scoito/RipThatSet | Python | ShazamIO (proprietary), ACRCloud fallback | Small project, ~4 stars | Yes, fixed 12s chunks, MM:SS timestamps | GPL-3.0 | Open source client, proprietary backend. |
| SongRec | github.com/marin-m/SongRec | Rust | Shazam API (proprietary) | Active, ~2,000 stars | No, single-clip recognition only | GPL-3.0 | Open source client, proprietary backend. In Arch official repos. |
| ShazamIO | github.com/shazamio/ShazamIO | Python (+ Rust core) | Reverse-engineered Shazam API (proprietary) | Active | No, library only, caller must chunk | Not stated (check repo) | Open source client, proprietary backend. Used by RipThatSet. |
| Wazam | github.com/Roshan-R/BillyBatson (Wazam) | Python/Django | Shazam via SongRec code (proprietary) | Small, ~8 stars | No | GPL-3.0 | Open source client, proprietary backend. Web UI demo, not a mix tool. |
| Dejavu | github.com/worldveil/dejavu | Python | Self-hosted fingerprint DB (MySQL/Postgres) | Mature, ~6.8k stars, low recent activity | Yes, reports offset in seconds | MIT | Fully open, no proprietary backend. You must build your own reference DB. |
| Panako | github.com/JorenSix/Panako | Java | Self-hosted fingerprint DB | Last release Feb 2022 | Yes, query/match start-stop seconds | AGPL-3.0 | Fully open. Built to survive pitch shift and time stretch — a real advantage for DJ mixes. |
| Olaf | github.com/JorenSix/Olaf | C (Zig wrapper) | Self-hosted fingerprint DB | Active | Yes, `--fragmented` mode splits query into 30s pieces with start/stop times | AGPL-3.0 | Fully open. Lightweight, runs on small devices. Newer sibling of Panako. |
| djmix-analysis (mir-aidj) | github.com/mir-aidj/djmix-analysis | Python | None (needs known track audio) | Research code, static | Yes, full subsequence alignment with cue points | Check repo (research code) | Academic code. Needs the exact source tracks, not a search index. |
| djmix-dataset (mir-aidj) | github.com/mir-aidj/djmix-dataset | — | — | Static dataset | N/A | Check repo | Dataset of real DJ mixes with tracklists, for evaluation. |
| unmixdb-creation | github.com/Ircam-RnD/unmixdb-creation | Python/shell | N/A (dataset generator) | Updated Oct 2024 | N/A | MIT | Builds the UnmixDB benchmark mixes. No identification algorithm inside. |
| audfprint | github.com/dpwe/audfprint | Python | Self-hosted fingerprint DB | Mature, low recent activity | Yes, match reports offset/time in the query | MIT | Fully open, general-purpose. Not DJ-specific — works on any long recording (radio, podcast, live set). |
| Echoprint (codegen + server) | github.com/spotify/echoprint-codegen, github.com/echonest/echoprint-server | C++ (codegen), Java/Solr (server) | Self-hosted Solr-backed fingerprint index | Inactive, unmaintained since Echo Nest shutdown | Yes, codes carry hash times | MIT (codegen) / Apache-2.0 (server) | Fully open, general-purpose. No maintained public database since Echo Nest closed. |
| auditok | github.com/amsehili/auditok | Python | N/A (energy-based VAD, no ID) | Active | Yes, segmentation only, no identification | MIT | General audio/silence segmentation tool. Useful as a pre-processing step to find candidate boundaries before fingerprinting. |
| CueGenerator | github.com/sergaph/CueGenerator | TypeScript | N/A (silence detection, no ID) | Small project, 2 commits | Segmentation only, no song identification | MIT | Splits a single long recording into a cue sheet using silence gaps. No fingerprinting or metadata lookup — only useful when tracks are separated by real silence, which DJ mixes and continuous radio rarely have. |

## 2. Tool Notes

### Tracklistify
Tracklistify records or reads a DJ mix, splits it into overlapping segments, and sends each segment to Shazam and ACRCloud for identification. It merges results into a tracklist with timestamps, and exports JSON, Markdown, and M3U.

Install on Arch: no AUR package found. Use pip: `pip install tracklistify` (or clone the repo and `pip install -e .`), plus `ffmpeg` from pacman (`sudo pacman -S ffmpeg`).

Limitations: it depends on Shazam and ACRCloud, both proprietary and rate-limited. It cannot identify unreleased or white-label tracks. Pitch-shifted or time-stretched DJ edits may fail to match, since neither backend guarantees tempo/pitch invariance. Overlapping tracks during transitions can produce false or missed matches near mix points.

### RipThatSet
RipThatSet cuts a DJ set into fixed 12-second chunks and queries ShazamIO for each chunk, falling back to ACRCloud when Shazam fails. Output is a list of tracks with MM:SS timestamps.

Install on Arch: not packaged. Clone the repo and `pip install -r requirements.txt`, needs Python 3.9+ and `ffmpeg` (pacman).

Limitations: same as Tracklistify — proprietary backend, fixed chunk size struggles with fast transitions or long intros/outros, no support for unreleased tracks, and pitch/tempo changes reduce Shazam's match rate.

### SongRec
SongRec is a Rust reimplementation of the Shazam client. It fingerprints a short clip and queries Shazam's servers. It does not include a segmentation loop for long files.

Install on Arch: available in the official repos: `sudo pacman -S songrec`.

Limitations: single-clip recognition only, so it needs an external script to slice a mix into segments and call SongRec per segment. Same proprietary-backend caveats as above (pitch shift, tempo change, unreleased tracks, overlapping audio during blends).

### ShazamIO
ShazamIO is a Python async library that wraps the reverse-engineered Shazam API. It is a building block, not a full mix-identification tool. RipThatSet is built on top of it.

Install on Arch: `pip install shazamio`.

Limitations: proprietary backend, no built-in chunking, subject to Shazam's undocumented rate limits and API changes.

### Dejavu
Dejavu is a self-hosted, fully open audio fingerprinting library. You feed it your own reference tracks to build a fingerprint database (MySQL or Postgres), then query it with clips from a mix. It reports a time offset in seconds, so it can, in principle, locate where in a mix a known track appears.

Install on Arch: no AUR package. Clone the repo, `pip install -e .`, and install MySQL or PostgreSQL from pacman (`sudo pacman -S mariadb` or `postgresql`).

Limitations: Dejavu's fingerprinting algorithm (based on spectrogram peak-pairs, like the original Shazam paper) is not robust to time-stretching or pitch-shifting, which are common in DJ mixes. You must already own copies of the candidate tracks — there is no shared public database. Project has low recent commit activity; many personal forks exist with unclear maintenance status.

### Panako
Panako is a self-hosted acoustic fingerprinting system built specifically to survive pitch shifting, time stretching, and speed changes. This directly targets the DJ-mix problem, where tracks are often pitched or time-stretched to match BPM. It reports match start/stop times in both query and reference audio.

Install on Arch: no package. Requires Java JDK 11+ and Gradle. Clone, run `./gradlew shadowJar` and `./gradlew install`, plus `ffmpeg` (pacman) for decoding.

Limitations: last release was February 2022, so it may lag behind newer audio formats or Java versions. Still needs a self-built reference database of candidate tracks. Overlapping tracks during a blend can create fingerprint noise that lowers match confidence. No public crowd-sourced database, unlike AcoustID.

### Olaf
Olaf is a newer, lightweight C implementation of a Shazam-style fingerprinting algorithm by the same author as Panako. It supports a `--fragmented` query mode that splits a long recording into 30-second pieces and matches each one, returning start/stop times — well suited to scanning a full DJ mix against a reference set.

Install on Arch: no package found. Requires `ffmpeg` and a C build toolchain (`base-devel` from pacman). Build with `make` then `sudo make install`.

Limitations: unclear from documentation whether it handles pitch/tempo shift as robustly as Panako — it targets small devices and speed over exhaustive invariance. Like Dejavu and Panako, you must supply your own reference track database.

### audfprint
audfprint is a general-purpose, landmark-based audio fingerprinting tool in Python, by Dan Ellis (dpwe). It is not DJ-specific: it works the same way on a DJ mix, a radio broadcast, a podcast, or a concert recording. You build a fingerprint database from your reference tracks, then run a match command against a long recording. It reports match times, so it can locate a known track's position inside a long file. It was used in published research to find ads inside long radio recordings, which is the same underlying task as finding songs inside a mix.

Install on Arch: no package. Clone the repo, `pip install librosa docopt`, plus `ffmpeg` (pacman).

Limitations: same as Dejavu and Panako — needs a self-built reference database, and landmark fingerprinting is sensitive to pitch shift and time stretch unless the reference and query are close in tempo/key.

### Echoprint
Echoprint was an open, two-part fingerprinting system (client codegen + Solr-based server) built by The Echo Nest, later owned by Spotify. Both parts are open source and general-purpose — not tied to DJ mixes. Useful as reference architecture, but the public Echo Nest database is gone, so it only works with a self-hosted server and self-supplied reference tracks. Appears unmaintained since the Echo Nest/Spotify integration wound down.

Limitations: unmaintained, no current public database, and Solr setup for the server is a nontrivial dependency.

### auditok
auditok is a general voice-activity and audio-segmentation tool. It has no notion of songs or fingerprints — it only finds boundaries between sound and silence. In a long recording with clean gaps (many radio shows, some podcasts), it can propose candidate track boundaries to feed into a fingerprinting step. It does nothing for DJ mixes or continuous sets, which rarely have true silence between tracks.

Install on Arch: `pip install auditok`.

Limitations: no identification, only silence-based segmentation. Fails on continuous or crossfaded audio.

### CueGenerator
CueGenerator is a small Node.js tool that detects silence gaps in a single MP3 and emits a `.cue` sheet with track boundaries. Like auditok, it does no identification — it assumes real silence between tracks, which is common in ripped CDs or some radio recordings but rare in DJ mixes, live shows, or crossfaded sets.

Install on Arch: `npm install` after cloning; needs `ffmpeg` (pacman) and Node.js (pacman `nodejs npm`).

Limitations: silence-only segmentation, no song identification, and very small/early-stage project (2 stars, 2 commits).

## 3. Academic Work

- **Schwarz & Fourer, "UnmixDB: A Dataset for DJ-Mix Information Retrieval"** (ISMIR-adjacent, published via Zenodo). Introduces a benchmark dataset of synthetic DJ mixes with full ground truth (track placement, effects, time-stretch). Dataset generation code: github.com/Ircam-RnD/unmixdb-creation (MIT). No identification algorithm is included, only the benchmark generator.
- **Schwarz & Fourer, "Methods and Datasets for DJ-Mix Reverse Engineering"** (Springer book chapter). Describes sample-precise alignment methods to find cue points and fade curves. Code availability not confirmed; check the authors' IRCAM pages.
- **Kim & Choi et al., "A Computational Analysis of Real-World DJ Mixes using Mix-To-Track Subsequence Alignment"** (ISMIR 2020, arXiv:2008.10267). Uses subsequence DTW on beat-synchronous MFCC/chroma features, with transposition-invariant matching for key changes. Code released: github.com/mir-aidj/djmix-analysis. This code assumes you already have the candidate source tracks — it aligns and finds cue points, it does not search a database to identify unknown tracks.
- **mir-aidj/djmix-dataset**: a companion dataset of real-world DJ mixes with known tracklists, for evaluating alignment and segmentation methods.
- **Raveform** (Transactions of ISMIR): a large dataset (4,902 mixes, 56,873 track links, 1,423 tracks with structure annotations) for EDM structure analysis in DJ mixes. Related to the mir-aidj group. Useful as evaluation data, not as an identification tool itself.

## 4. Recommendation

Test these three first:

1. **Tracklistify** — fastest path to a working end-to-end pipeline (download from YouTube/SoundCloud/Mixcloud, segment, identify, output timestamps). Good baseline to see what proprietary APIs can already do, and its segmentation logic is reusable even if the backend is swapped later.
2. **Panako** — the only fully open, self-hosted fingerprinting system explicitly built to handle pitch shift and time stretch, which are the main failure modes for DJ mixes. Worth testing against a small reference set of known tracks to see real-world match quality on pitched/stretched audio.
3. **mir-aidj/djmix-analysis** — the closest match to actual DJ-mix behavior (subsequence alignment, cue points, key-change tolerance) with released code and a paired real-world dataset. Useful once you have candidate tracks and want to confirm exact placement and cue points, or to benchmark other tools against real mixes with known ground truth.

Keep Dejavu, Olaf, and audfprint as fallback self-hosted fingerprinting options if Panako's setup proves too heavy — audfprint in particular is worth a look since it is proven on long, continuous recordings beyond just DJ mixes (it was used to find ads in radio broadcasts, the same core task). Treat SongRec/ShazamIO-based tools only as a proprietary-backend comparison point, not the long-term solution, since they depend on Shazam's undocumented API. Use auditok or CueGenerator only as an optional pre-processing step for source material with real silence gaps (some radio or podcast recordings) — they add nothing for continuous DJ mixes or live sets.
