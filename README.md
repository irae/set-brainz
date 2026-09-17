# set-brainz research

Goal: get a tracklist with timestamps from a long mixed recording (DJ set, live show, radio show).

Files:

- `research-existing-tools.md` — open source tools that already do part of the job, with a recommendation on what to test first.
- `research-fingerprinting-backends.md` — matching backends (AcoustID, Panako, Olaf, audfprint, Shazam clients), their limits, and a proposed strategy.
- `environment-check.md` — what is installed on this machine, what the repos and AUR offer, and install commands (not run).

Short conclusion from the research:

- No open source tool covers all four goals. Partial results exist.
- Fully open matchers (Panako, Olaf, audfprint, dejavu) need a reference library that you build yourself. There is no open crowd-sourced index.
- AcoustID + MusicBrainz is open but matches short, mid-track, pitch-shifted clips badly.
- SongRec, shazamio, Tracklistify, RipThatSet are open source clients on a closed Shazam backend. They give the fastest baseline.
- Panako is the best open candidate for pitched or time-stretched clips.

Next step: test Tracklistify or SongRec on one set for a baseline, then test Panako with a local library.

Setup: Node 20 or later, then `npm install` once, in the project root.

Scripts, in run order:

1. `scripts/download-audio.sh <youtube-url>` — audio-only download into `data/audio/<video-id>/`, plus an MP3 copy.
2. `scripts/install-tracklistify.sh` then `scripts/run-tracklistify.sh <video-id>`.
3. `scripts/install-ripthatset.sh` then `scripts/run-ripthatset.sh <video-id>`. Run after Tracklistify, not with it.
4. `scripts/merge-results.py <video-id>` — merges both runs into `data/merged/<video-id>/<timestamp>-<video-id>.json`, all variants kept.
5. `npm start` — starts the decisions app on `http://127.0.0.1:8765/`. Open that address, pick the set, and record your decisions there.

Local data:

All local data lives in `data/`. Third-party tool clones live in `tools/`. Git ignores both folders. No tracked file names a video.

| Path | Content |
|---|---|
| `data/audio/<video-id>/` | downloaded audio and the MP3 copy |
| `data/runs/<video-id>/tracklistify/` | Tracklistify log and tracklist files |
| `data/runs/<video-id>/ripthatset/` | RipThatSet log and JSON |
| `data/merged/<video-id>/` | merged JSON files, one per merge |
| `data/decisions/` | one decision file per video, holding its rows and tracks |
| `data/views/<video-id>/` | old generated views, kept on disk, no script writes there now |
| `data/tmp/` | temporary audio chunks |
| `tools/tracklistify/`, `tools/ripthatset/` | tool clones with their own environments |
