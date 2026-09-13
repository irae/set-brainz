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

Scripts, in run order:

1. `scripts/download-audio.sh <youtube-url>` — audio-only download into `audio/`, plus an MP3 copy.
2. `scripts/install-tracklistify.sh` then `scripts/run-tracklistify.sh audio/<file>.mp3`.
3. `scripts/install-ripthatset.sh` then `scripts/run-ripthatset.sh audio/<file>.mp3`. Run after Tracklistify, not with it.

Audio, tool clones, logs, and result files stay out of git.
4. `scripts/merge-results.py` — merges both results into `results/merged.md`, all variants kept.
5. `scripts/build-table.py <video-id>` — builds `results/tracklist.html` with a player and jump links.
6. `scripts/serve-results.sh` — serves `results/` on port 8765 and opens the table. The YouTube embed refuses `file://` pages.
