# Agent rules — set-brainz

This project finds the tracks in a long mixed recording and records the decisions of the owner about them.

These rules bind every agent in this repository.

## Roles

- The main agent coordinates, reviews diffs, and rules on findings. It does not write app code, does not run a browser, and does not run the test suite. Only the owner lifts this, for one task.
- The main agent records each ruling in its message to the owner.
- Subagents implement. Each one commits its own work before it returns.
- An implementer never dispatches a subagent and never dispatches a reviewer. The review comes from the main agent.
- A subagent reports status, commits, the test result, and concerns. The long report goes to the file its dispatch names.
- The owner decides design questions. Raise a conflict once, take the answer, and continue.

## Privacy

- No tracked file holds a video ID, a set name, a video URL, a recording file name, or any other pointer to what the owner listens to.
- Tests use fixture video IDs in the style `TESTVIDEO01`.
- Never send the owner's data to an outside service. No upload, no paste site, no issue tracker, no published page.
- The commit address of the owner is public and stays as it is.

## Local data

- `data/` holds all local data. `tools/` holds third-party clones. Git ignores both. Never commit anything under them.
- The data folder comes from `SETBRAINZ_DATA_DIR` and falls back to `data`.
- The page folder comes from `SETBRAINZ_PUBLIC_DIR` and falls back to `app/public`.
- Never write to `data/decisions/`. It holds the work of the owner. To test a write, copy `data/`, point `SETBRAINZ_DATA_DIR` at the copy, and work there.
- `data/decisions/<video-id>.prev.json` holds the one step of undo. Never delete it.
- Never run the merge script in a way that writes a new merged file unless the owner asks. A newer merged file does not migrate the decisions.

| Path | Content |
|---|---|
| `data/audio/<video-id>/` | downloaded audio and the MP3 copy |
| `data/runs/<video-id>/` | logs and results from the identification tools |
| `data/runs/<video-id>/runner.log` | output of the job runner itself; empty unless the runner crashes |
| `data/merged/<video-id>/` | merged JSON files, one per merge |
| `data/decisions/` | the decisions of the owner, one file per video |
| `data/views/<video-id>/` | old generated views |
| `data/tmp/` | temporary audio chunks |

## The owner's server

- The owner runs the app on port `8765` and works in it. Never write to it, never restart it, and never bind that port.
- Use another port, with a copy of the data folder.
- The server sends the page files from disk on every request. A reload reaches the owner's browser. Restart only when the owner asks, or when a change cannot reach the page any other way.
- The server binds `SETBRAINZ_HOST`, which falls back to `0.0.0.0`, and `SETBRAINZ_PORT`, which falls back to `8765`.

## Page and store rules

- An action that saves also redraws the row. A save the page does not show is a save the owner does not trust.
- Every request shows its failure, with the status code. Nothing fails in silence.
- A merge keeps the surviving row's start, track and note, and fills each empty one from the row that goes away. A merge never turns a decided row into an undecided one.
- Never compute a smallest or largest value from an empty list. A row with no sources is normal, because the owner adds rows.
- The decision of the owner always wins over a guess, in every row and in every column.

## Code

- Node 20 or later. npm only. ES modules. Plain JavaScript. No TypeScript.
- No frontend framework and no build step. jQuery is the only frontend library, served from local disk. No content delivery network.
- Python scripts use the standard library only.
- Ask the owner before adding a dependency.
- Write pragmatic code. Prefer fewer moving parts. Do not extract a helper with one call site. Do not name a value used twice.
- Do not write code comments. Two exceptions: the owner asks, or the code cannot show a hidden behaviour that crosses files or a fault of an outside service. A comment never restates the code.
- Build only what the task asks for. Extra features are a defect.

## Tests

- `npm test` runs the fast tests. It is the development loop, and it never contains a browser test.
- `npm run test:browser` runs the browser tests.
- Write unit tests. They are the loop.
- The order of work is: build it, check it by hand in a browser, then write a unit test that proves the behaviour.
- Write a browser test only for behaviour a unit test cannot prove.
- Run the browser tests when you suspect a fault the unit tests miss, or when the owner asks.
- Update the browser tests after the work reaches the owner, never before.
- Never delete a browser test to make a run faster. Trim one only when a unit test covers the same behaviour.
- A test drives the real thing and checks the real result. A test that reads an internal cache where it must read a file proves nothing.
- Update the tests of the code you change.
- No test writes into the tracked tree. A test writes only into a temporary folder that it removes.

## Browsers

- Use a browser only to see a real page. Everything else is a unit test.
- Drive a browser only through the `playwright-cli` skill, and pass the headless parameter on every command.
- On this machine, `playwright-cli` is an Omarchy mise wrapper for `npm:@playwright/cli`. Run it from the repo root, so it reads `.playwright/cli.config.json`, which keeps the browser headless. Never pass `--headed`. If `playwright-cli --version` does not print a `0.x` version, stop and tell the main agent. The fix is `omarchy-mise-install npm:@playwright/cli playwright-cli`.
- Never open a tab or a window on the desktop of the owner. Never run `xdg-open`, `open`, `sensible-browser`, `firefox`, `chromium`, or any other command that opens a window.
- Take a screenshot when you must see the page, and write what you saw.

## 1001Tracklists

- The site blocks fast traffic with a bot challenge. Every agent that loads the site acts like a slow human user.
- Wait a random 10 to 30 seconds between two page loads, two clicks, or two requests. Never run two sessions at the same time.
- Move through the site in sequence, as a user does: follow links on the page, or go back. Type a URL only for the first page of a session.
- Load the fewest pages the task needs. Write the page budget in the report.
- On a challenge page, stop at once. Do not retry. Report it to the main agent.
- A post to the site happens only when the owner presses `post to 1001`, or when the owner names one post in the task.

## Handoff

- The handoff lives at `scratchpad/handoff.md`. It is untracked, and it never enters git history.
- It holds the state, the open work, and the decisions the owner made. It never holds commits or steps, because git holds those.
- One file, many handoffs. Add a dated section at the end. Never remove an older section.
- Keep it short enough to read in one pass.
- A rule that binds future work belongs in this file, not in the handoff.

## Prose

- Write all prose in ASD-STE100 Simplified Technical English. Short sentences. Active voice. One idea per sentence. One word for one meaning.
- This covers chat replies, reports, commit messages, and prompts to other agents.
- Pass this rule on when you dispatch an agent.

## Git

- Commit messages say what changed. They never name a task number, a phase, a step, or other planning mechanics.
- End a commit message with one co-author line that names the model you run as, with its address. A subagent on Sonnet writes Sonnet. This holds for a model of any maker.
- Add nothing else. No session address, and no other trailer.

```
Co-Authored-By: <the model you run as> <its address>
```

- Commit when the owner asks, or when your task says to commit.
- `AGENTS.md` stays untracked. Never commit it, stage it, or delete it.

## Where things live

- The design of the app: `docs/superpowers/specs/2026-09-16-decisions-app.md`, untracked by a global rule. Keep it current. It is the only written record of the page rules.
- The rules: this file.
- The state and the open work: `scratchpad/handoff.md`.
