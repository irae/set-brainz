#!/usr/bin/env python3
# Merge the Tracklistify and RipThatSet runs in data/runs/<video-id>/
# into data/views/<video-id>/merged.md. Every remix/version variant is kept, never collapsed.
# Usage: scripts/merge-results.py <video-id>
import json, os, re, sys
from collections import defaultdict

SEG = 12                       # RipThatSet chunk length in seconds
GAP = 8 * 60                   # same track seen again within this gap = same play
MAX_SEG_GAP = 4                # RipThatSet: chunks without a hit tolerated inside one run


def hms(s):
    s = int(s)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def base_title(title):
    t = re.sub(r"[\(\[].*?[\)\]]", "", title)
    t = re.sub(r"\s*-\s*(single|ep|mixed|extended.*|radio edit.*|original mix.*)$", "", t, flags=re.I)
    return re.sub(r"\W+", " ", t).strip().lower()


def key(artist, title):
    a = artist.split("&")[0].split(",")[0].strip().lower()
    return f"{a}|{base_title(title)}"


# RipThatSet bug: the file list was sorted as text, so the N-th processed chunk
# is the N-th name in text order, not chunk N. Rebuild that permutation.
def real_index_map(total):
    names = sorted(f"segment_{i:03d}" for i in range(total))
    return [int(n.split("_")[1]) for n in names]


def ripthatset_hits(path):
    text = open(path, encoding="utf-8", errors="replace").read().replace("\r", "\n")
    lines = []
    for ln in text.split("\n"):
        ln = re.sub(r"\x1b\[[0-9;]*m", "", ln).rstrip()
        if ln.startswith(("◆", "○")):
            lines.append(ln)
        elif lines and ln and not ln.startswith(("Splitting", "Processing", "ACRCloud", "✨", "Final", "Analysis", "Results")):
            lines[-1] += " " + ln.strip()
    hits = []
    for ln in lines:
        m = re.match(r"◆ Found \[[\d:]+\] \(segment (\d+)\): (.*?) - (.*?) via \w+", ln)
        if m:
            hits.append((int(m.group(1)) - 1, m.group(2).strip(), m.group(3).strip()))
    return hits


def ripthatset_runs(log, total):
    order = real_index_map(total)
    hits = sorted((order[pos], a, t) for pos, a, t in ripthatset_hits(log) if pos < total)
    runs = []
    last = {}
    for idx, a, t in hits:
        k = (a, t)
        r = last.get(k)
        if r and idx - r["last_idx"] <= MAX_SEG_GAP:
            r["last_idx"] = idx
            r["count"] += 1
        else:
            r = {"artist": a, "title": t, "first_idx": idx, "last_idx": idx, "count": 1}
            runs.append(r)
            last[k] = r
    return [{"src": "R", "artist": r["artist"], "title": r["title"],
             "start": r["first_idx"] * SEG, "end": (r["last_idx"] + 1) * SEG,
             "count": r["count"], "conf": None} for r in runs if r["count"] >= 2]


def tracklistify_hits(path):
    out = []
    for t in json.load(open(path))["tracks"]:
        h, m, s = map(int, t["time_in_mix"].split(":"))
        start = h * 3600 + m * 60 + s
        out.append({"src": "T", "artist": t["artist"], "title": t["song_name"],
                    "start": start, "end": start + 60, "count": 1, "conf": t["confidence"],
                    "links": (t.get("metadata") or {}).get("links") or {}})
    return out


def merge(events):
    events.sort(key=lambda e: e["start"])
    tracks = []
    open_tracks = {}
    for e in events:
        k = key(e["artist"], e["title"])
        tr = open_tracks.get(k)
        if tr and e["start"] - tr["end"] <= GAP:
            tr["end"] = max(tr["end"], e["end"])
        else:
            tr = {"key": k, "artist": e["artist"], "start": e["start"], "end": e["end"], "variants": {}}
            tracks.append(tr)
            open_tracks[k] = tr
        v = tr["variants"].setdefault(e["title"], {"T": [], "R": [], "start": e["start"], "end": e["end"]})
        v[e["src"]].append(e)
        v["start"] = min(v["start"], e["start"])
        v["end"] = max(v["end"], e["end"])
    tracks.sort(key=lambda t: t["start"])
    return tracks


def variant_line(title, v):
    parts = []
    if v["R"]:
        parts.append(f"R {sum(e['count'] for e in v['R'])} chunks")
    if v["T"]:
        conf = max(e["conf"] for e in v["T"])
        parts.append(f"T {len(v['T'])}x {conf:.0f}%")
    return f"{title} — {', '.join(parts)} — {hms(v['start'])}–{hms(v['end'])}"


def main():
    vid = sys.argv[1]
    runs = f"data/runs/{vid}"
    log = f"{runs}/ripthatset/run.log"
    total = int(re.search(r"Processing (\d+) segments", open(log, errors="replace").read()).group(1))
    events = tracklistify_hits(f"{runs}/tracklistify/tracklist.json") + ripthatset_runs(log, total)
    tracks = merge(events)
    lines = ["# Merged tracklist", "",
             "Sources: T = Tracklistify (60 s segments, Shazam), R = RipThatSet (12 s chunks, Shazam).",
             "Start is the earliest hit from any source. Both = seen by both tools.", "",
             "| # | Start | End | Track | Artist | Both | Variants |", "|---|---|---|---|---|---|---|"]
    for i, t in enumerate(tracks, 1):
        srcs = {s for v in t["variants"].values() for s in ("T", "R") if v[s]}
        both = "yes" if srcs == {"T", "R"} else ""
        first = next(iter(t["variants"]))
        variants = "<br>".join(variant_line(k, v) for k, v in t["variants"].items())
        lines.append(f"| {i} | {hms(t['start'])} | {hms(t['end'])} | {base_title(first).title()} | {t['artist']} | {both} | {variants} |")
    os.makedirs(f"data/views/{vid}", exist_ok=True)
    open(f"data/views/{vid}/merged.md", "w").write("\n".join(lines) + "\n")
    print(f"{len(tracks)} tracks, {sum(1 for t in tracks if len(t['variants']) > 1)} with several variants")


if __name__ == "__main__":
    main()
