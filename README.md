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

`npm test` runs the fast test suite. It skips the browser tests, so it takes about a second.

`npm run test:browser` runs the set page tests in a real headless browser. It takes minutes.

The two set page tests in `tests/set-page.test.js` need the `playwright-cli` tool on `PATH`. Without it, those two tests skip and the rest of the suite still runs.

Quick workflow:

1. Run `npm start` and open `http://127.0.0.1:8765/`.
2. Add a set. Save the source URL, title and optional 1001Tracklists URL.
3. Open the edit page. Choose Download, then Process. Reload the page to see status.
4. Open the decisions page after processing completes.

Underlying scripts, in run order:

1. `scripts/download-audio.sh <set-id> <source-url>` — audio-only download into `data/audio/<set-id>/` as an MP3.
2. `scripts/install-tracklistify.sh` then `scripts/run-tracklistify.sh <set-id>`.
3. `scripts/install-ripthatset.sh` then `scripts/run-ripthatset.sh <set-id>`. Run after Tracklistify, not with it.
4. `scripts/merge-results.py <set-id>` — merges both runs into `data/merged/<set-id>/<timestamp>-<set-id>.json`, all variants kept.

By default, the app binds to every address. Set `SETBRAINZ_HOST` to narrow this to one address, for example the loopback address or a Tailscale address, and set `SETBRAINZ_PORT` to change the port. The app has no login, so the network it sits on decides who can use it.

Local data:

All local data lives in `data/`. Third-party tool clones live in `tools/`. Git ignores both folders. No tracked file names a video.

| Path | Content |
|---|---|
| `data/sets.json` | source URL, title and 1001Tracklists URL for each set |
| `data/jobs/<set-id>.json` | download and processing status |
| `data/audio/<set-id>/` | downloaded MP3 audio |
| `data/runs/<set-id>/tracklistify/` | Tracklistify log and tracklist files |
| `data/runs/<set-id>/ripthatset/` | RipThatSet log and JSON |
| `data/merged/<set-id>/` | merged JSON files, one per merge |
| `data/decisions/` | one decision file per video, holding its rows and tracks |
| `data/views/<video-id>/` | old generated views, kept on disk, no script writes there now |
| `data/tmp/` | temporary audio chunks |
| `data/cookies/1001.cookies.txt` | 1001Tracklists cookies, Netscape format, exported from a logged-in browser |
| `data/1001/browser.json` | the browser fingerprint the poster copies: user agent, languages, window and screen size, time zone |
| `data/1001/tracklists.json` | map from video id to the 1001Tracklists tracklist URL of that set |
| `data/1001/post-log.jsonl` | one JSON line per step of every post attempt |
| `data/1001/posts/` | screenshots and saved pages from each post attempt |
| `tools/tracklistify/`, `tools/ripthatset/` | tool clones with their own environments |

Posting to 1001Tracklists:

1. Log in to 1001Tracklists in your browser. Export the cookies of the site with a cookies.txt extension, and save them as `data/cookies/1001.cookies.txt`.
2. Save the browser fingerprint as `data/1001/browser.json`. It holds `ua`, `lang`, `langs`, `viewport`, `screen`, `dpr`, `tz`, `touch`, and `mobile`.
3. Add the tracklist URL on the set edit page. Existing sets can still use `data/1001/tracklists.json` as a fallback map:

```json
{ "<video-id>": "https://www.1001tracklists.com/tracklist/<code>/<name>.html" }
```

4. In the set page, a ready row shows `post to 1001`.
