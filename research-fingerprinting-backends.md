# Audio Fingerprinting Backends for DJ Mix Identification

Goal: identify a 10-60 second clip cut from a DJ mix. Mixes have three hard problems:
1. The clip starts and ends mid-track, not at track boundaries.
2. Tracks often run pitch/tempo shifted by +/- 6 percent (vinyl-style pitch control).
3. Two tracks can overlap during a transition.

Note: these three problems are not unique to DJ mixes. A radio show recording, a live concert set, a podcast with music beds, or any other long mixed recording needs the same short-clip, mid-track matching. All findings below apply to any long recording, not only DJ mixes.

## 1. Summary table

| Backend | URL | License | Needs internet | Robust to pitch/tempo shift | Works on partial clips | Needs own reference library | Arch Linux install path |
|---|---|---|---|---|---|---|---|
| MusicBrainz via AcoustID + Chromaprint | https://acoustid.org | LGPL (Chromaprint), server code MIT-ish | Yes (hosted API) | No | No (needs near-full track) | No (uses MusicBrainz/AcoustID DB) | `pacman -S chromaprint`, `pip install pyacoustid` |
| Panako | https://github.com/JorenSix/Panako | AGPL | No (local) | Yes, up to about 10 percent | Yes (query fragment as short as a few seconds) | Yes | AUR none; build with `java-runtime` + `gradlew` |
| Olaf | https://github.com/JorenSix/Olaf | AGPL | No (local) | Partial (small pitch tolerance, not large stretch) | Yes | Yes | Build from source with `gcc`/`make`, no AUR package |
| audfprint | https://github.com/dpwe/audfprint | MIT | No (local) | No (landmark hashes break under pitch shift) | Partial (short noisy queries, not pitch-shifted) | Yes | `pip install librosa docopt`, clone repo |
| dejavu | https://github.com/worldveil/dejavu | MIT | No (local) | No | Partial (short clips, no pitch shift) | Yes | `pip install PyDejavu` (unmaintained, expect breakage) |
| SoundFingerprinting | https://github.com/AddictedCS/soundfingerprinting | Apache 2.0 | No (local) | Yes, if playback speed percentage is known and given as a hint | Yes | Yes | `dotnet add package SoundFingerprinting`; needs `dotnet-sdk` from `pacman` |
| SongRec | https://github.com/marin-m/SongRec | GPLv3 (client only) | Yes, uses Shazam servers | Unknown (Shazam backend, proprietary) | Yes | No | AUR `songrec` |
| shazamio | https://github.com/shazamio/ShazamIO | MIT (client only) | Yes, uses Shazam servers | Unknown (Shazam backend, proprietary) | Yes | No | `pip install shazamio` |

Note on the two Shazam clients: the client code is open source, but all matching runs on Shazam's proprietary backend. Mark both as "open source client, proprietary backend."

## 2. Backend details

### AcoustID + Chromaprint

AcoustID is a hosted lookup service. Chromaprint is the fingerprint library (`fpcalc` tool) it uses. Results link to MusicBrainz metadata.

Limits found:
- Chromaprint targets full-file identification and duplicate detection. It is not built for short or offset queries.
- A community thread on MetaBrainz Discourse confirms this directly: chopping a DJ mix into 10-second slices and querying AcoustID does not work well, because Chromaprint produces different hashes for the same audio at different start offsets. The system needs close to the full track, not an arbitrary fragment.
- Pitch/tempo shift of a few percent (typical of DJ mixing) degrades match quality further; Chromaprint has no built-in tolerance for this.
- Overlapping tracks (mix transitions) are not handled at all; Chromaprint expects one source signal.
- API: free tier allows 3 requests per second per API key. Paid tiers remove the rate limit (about 50-100 EUR/month for 1-15 million lookups).
- An API key is required for both submitting fingerprints and querying.
- The AcoustID database dump is public. `data.acoustid.org` publishes daily incremental JSON dumps you can pull and rebuild locally. The `acoustid-server` code is also open source, but the project states it is "only meant to run on acoustid.org" — running your own instance is possible but unsupported and non-trivial (needs the full MusicBrainz Postgres schema plus a fingerprint-matching index).

Conclusion: good only for identifying a full, unshifted, isolated track. Not suited to raw mix clips without pre-processing (stem separation, track-boundary detection) first.

Arch install:
```
pacman -S chromaprint
pip install pyacoustid
```

### Panako

Panako (Joren Six) is built for exactly this problem: short fragments, pitch-shifted and time-stretched audio, against a local database you build yourself.

- Handles time-scale and pitch modification up to about 10 percent, which covers typical DJ pitch-fader ranges (usually +/- 6 to 8 percent).
- Works on short query fragments, not full tracks.
- Latest tagged version is 2.1 (2022); the codebase is still the reference implementation cited in newer papers, so treat it as stable rather than abandoned.
- License is AGPL, so a network-facing service built on Panako must offer its source to users.
- Needs Java 11 or later (project builds against Java 17 by default) and `ffmpeg` for decoding.

Arch install:
```
pacman -S jdk-openjdk ffmpeg
git clone --depth 1 https://github.com/JorenSix/Panako.git
cd Panako
./gradlew shadowJar
./gradlew install
sudo cp resources/defaults/panako /usr/local/bin
```

Build a local database and query it:
```
panako store /path/to/your/music/*.mp3
panako query short_clip.mp3
```

No AUR package exists; build from source.

### Olaf

Olaf (Joren Six) is Panako's lightweight sibling, written in C, designed to run even on microcontrollers (ESP32, Arduino, Teensy).

- Fast: the paper reports about 30x speedup over one comparable system and about 1000x over another.
- Tolerates only a small pitch tolerance, not large time-stretch like Panako. Better fit for near-exact matching at low resource cost than for heavily pitch-shifted DJ audio.
- AGPL licensed. No AUR package; build with `gcc`/`make` from source.

Use case: an efficient local matcher when the query is close to the original pitch/tempo (e.g., matching against your own unreleased tracks recorded at their native speed).

### audfprint

Dan Ellis's landmark-based fingerprinting system (Python, depends on `librosa`).

- Designed for noisy, short queries (e.g., a phone recording of a song playing in a room), similar in spirit to Shazam's original algorithm.
- No pitch/tempo tolerance: landmark hash pairs shift under pitch change and the system loses matches.
- Good local option when clips are not pitch-shifted (e.g., verifying unmixed source tracks).

Arch install:
```
pacman -S python-pip
pip install librosa docopt
git clone https://github.com/dpwe/audfprint.git
```

### dejavu

Python audio fingerprinting and recognition (worldveil/dejavu), inspired by the Shazam algorithm.

- The original repository is largely unmaintained; several community forks exist (Zizouz212, soruly, ProvenanceLabs) with fixes for newer Python/dependency versions.
- Like audfprint, no pitch/tempo robustness.
- Needs its own database (MySQL/Postgres/SQLite backend) built from your library.

Arch install: no AUR package for the maintained forks; clone and `pip install` from a fork such as `Zizouz212/dejavu`.

### SoundFingerprinting (.NET)

C# library, actively maintained, Apache 2.0 licensed.

- Supports a `sourcePlaybackSpeedPercentage` parameter: if you know (or estimate) the pitch-shift percentage of a DJ mix, you can pass it to compensate before fingerprinting. This is a manual hint, not automatic detection of arbitrary shift.
- Fingerprint granularity is about 1.46 seconds, well suited to 10-60 second clips.
- Needs its own reference database (the library ships pluggable storage backends).

Arch install:
```
pacman -S dotnet-sdk
dotnet add package SoundFingerprinting
```

### SongRec and shazamio (Shazam clients)

Both are open source client code, proprietary backend. Neither needs its own reference database — Shazam holds a database.

- SongRec: Rust, GPLv3, packaged in the AUR (`songrec`). Sends fingerprint tuples (not raw audio) to Shazam's servers.
- shazamio: Python, MIT, `pip install shazamio`, no API key needed since it reverse-engineers Shazam's private API.
- Robustness to pitch/tempo shift is unknown and undocumented, since the matching algorithm runs server-side and is not open. Treat as a black box; expect similar limits to AcoustID for heavily shifted or overlapping audio, since Shazam is also a landmark-based system without published pitch tolerance for DJ-range shifts.
- Risk: reliance on an undocumented, reverse-engineered API that Shazam can change or block at any time.

Arch install:
```
paru -S songrec   # AUR
pip install shazamio
```

### Newer/other projects

- A Rust crate named `fingerprint` (crates.io, MIT, version 0.0.3, mid-2026) claims support for Wang (Shazam-style), Panako, and Haitsma-Kalker algorithms with streaming and in-memory matching. It is very early-stage (pre-1.0, sparse ecosystem adoption) — worth watching but not production-ready today.
- Various smaller "Shazam-like" Rust/Python toy projects surface on GitHub Topics (`acoustic-fingerprinting`, `audio-fingerprinting`, `shazam-like`) but none has the maturity or pitch-tolerance of Panako.
- Academic neural fingerprinting work (2025-2026 arXiv papers on neural/conformer-based fingerprinting, extreme time-stretch robustness) is promising but has no ready-to-run open source backend yet.

### MusicBrainz: metadata only, matching goes through AcoustID

Confirmed: MusicBrainz itself does not do audio matching. It is a metadata database only. AcoustID is a separate project that computes Chromaprint fingerprints and links them to MusicBrainz identifiers. MusicBrainz Picard calls out to the AcoustID web service to resolve a file's fingerprint into a MusicBrainz ID.

Note: AcousticBrainz (a related MetaBrainz project that stored acoustic features like key, BPM, and beat patterns) was shut down in 2022 and its dataset is no longer queryable as a live service, only as a static dump. It was never designed for fragment-level identification.

### Fingerprint databases and metadata coverage for electronic music

- There is no free, open, pre-built fingerprint database of electronic music beyond what AcoustID/MusicBrainz already index — and only for tracks that someone has already fingerprinted with `fpcalc` and submitted.
- MusicBrainz has had full track-level metadata since 2011 and includes reasonable coverage of released electronic music, including many labels and back-catalog. Discogs has broader release-level and label/catalog-number coverage, especially for vinyl-only or small-label electronic releases, but weaker structured track-level data historically.
- White label and unreleased tracks (common in DJ mixes) are the weak point for both: Discogs catalogs true white labels under a "Not On Label" placeholder, and neither database has audio for tracks nobody has fingerprinted or logged. For these, no external database will ever match; the only option is building your own reference library and matching locally (Panako, Olaf, SoundFingerprinting).

## 3. Which backend fits DJ mixes best, and why

No single backend solves this alone. The right approach depends on splitting the problem:

1. **Track segmentation first.** Detect approximate transition points in the mix (energy/spectral change or beat-grid discontinuity) so each fingerprinting call runs on a bounded window rather than the whole mix. This step is separate from fingerprinting itself.
2. **For released, catalogued tracks:** try AcoustID first, but do not feed it raw 10-60 second clips of pitch-shifted, mid-track audio — it was not built for that and the community consensus confirms it does not work well for DJ mix identification. Use it only after isolating and, if possible, correcting pitch/tempo of a clean single-track segment.
3. **For pitch/tempo-shifted or partial-clip matching, self-hosted:** Panako is the strongest fit. It explicitly targets short fragments plus pitch/time-stretch up to about 10 percent, which covers the DJ pitch-fader range. Build a Panako database from a personal collection (your own DJ pool, Beatport purchases, Bandcamp downloads) and query clips straight from the mix.
4. **For unreleased/white-label/promo tracks:** there is no external database to query. Panako (or SoundFingerprinting, if a .NET stack is preferred) against a locally curated library is the only option, since these tracks will never appear in AcoustID or Shazam.
5. **Overlapping tracks during transitions:** none of these tools natively separate two simultaneous tracks. If needed, run a source-separation model (e.g., Demucs) on the transition window first, then fingerprint each separated stem independently against the local database.
6. **As a fallback / cross-check:** query the same clip against SongRec/shazamio. Being backed by Shazam's much larger proprietary database, they may catch a mainstream track that a self-hosted database lacks — but treat any result as unverified since the matching logic is closed and undocumented for pitch-shifted or overlapping input.

Recommended stack: Panako as the primary local matcher against a purpose-built reference library, AcoustID as a secondary check for clean/unshifted segments, and a Shazam client as a last-resort fallback for mainstream tracks not in your library.

## 4. Additional projects found in a wider search

The wider search covered general open source music recognition, not only DJ-mix-specific tools. It surfaced a few more projects and one dead end.

### Echoprint (Echo Nest / Spotify) — dead

Echoprint was an open source fingerprinting framework built by The Echo Nest, later acquired by Spotify. Code generator (MIT) and server (Apache 2.0) code are still on GitHub (`spotify/echoprint-codegen`, `echonest/echoprint-server`), but the public fingerprint database (`echoprint.me/data/`) was taken down around 2017. Without that database, Echoprint has no reference data to match against. Treat it as historical, not usable today.

### Newer small Rust projects

- `rusty-chromaprint` (https://github.com/darksv/rusty-chromaprint) — a Rust re-implementation of Chromaprint's algorithm. Useful if you want fingerprint generation without the C library, but it inherits Chromaprint's same weaknesses for partial clips and pitch shift, since it targets the same algorithm.
- `shezem-rs` (https://github.com/Kither12/shezem-rs) — a small Rust CLI implementing a Shazam-style (landmark/peak) fingerprinting and matching system, with its own local database. No published pitch-shift tolerance; likely similar limits to audfprint/dejavu.
- `khalzam` (https://github.com/kisasexypantera94/khalzam) — a simple C++ audio recognition library, Shazam-style peak-hashing, local database. Same caveat: no pitch/tempo tolerance documented.
- A cross-recording, long-form-archive fingerprinting project in Rust (mmap-backed, Panako-compatible matching, "passage-level evidence") turned up in search results, aimed at exactly the long-recording use case (radio archives, etc.), but it is small/niche with limited documentation; worth a closer look if Panako's Java stack is undesirable, but not yet a drop-in replacement.

These are all much smaller and less proven than Panako, Olaf, audfprint, dejavu, or SoundFingerprinting. None beats Panako's combination of maturity, published pitch/time-stretch tolerance, and local-database support for the long-recording use case.

### Other general/commercial-adjacent options

- ACRCloud and AudD are commercial audio recognition APIs with broadcast-monitoring features (used for radio/TV ad tracking). Not open source, and not free, but confirm the general shape of the problem: broadcast/long-recording identification is a known commercial niche, solved industrially by continuously fingerprinting known reference audio and matching short excerpts against it — the same approach recommended here with Panako/Olaf/SoundFingerprinting for a self-hosted setup.
- `AudioAuditor` and `Audile` (Android) are open source apps that call out to existing backends (AudD, ACRCloud, Shazam) rather than implementing their own matching. They are open source clients, not new backends — same category as SongRec/shazamio.

### Conclusion of the wider search

No new project changes the recommendation in section 3. Panako remains the strongest open source, self-hosted choice for short, pitch/tempo-shifted clips from any long mixed recording (DJ mix, radio show, live set). AcoustID/Shazam clients remain useful only as a secondary check on clean, unshifted, isolated segments of released tracks.
