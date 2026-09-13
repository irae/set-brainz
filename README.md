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
