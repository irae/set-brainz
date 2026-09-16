#!/usr/bin/env python3
# Merge the Tracklistify and RipThatSet runs in data/runs/<video-id>/
# into a merged JSON file under data/merged/<video-id>/. Every remix/version
# variant is kept, never collapsed.
# Usage: scripts/merge-results.py <video-id> [--force]
import hashlib, json, os, re, sys, time, uuid
from datetime import datetime, timezone

SEG = 12                       # RipThatSet chunk length in seconds
GAP = 8 * 60                   # same track seen again within this gap = same play
MAX_SEG_GAP = 4                # RipThatSet: chunks without a hit tolerated inside one run
MIN_RUN_COUNT = 2              # RipThatSet: chunks needed before a run counts as a hit
GAP_ROW_SECONDS = 90           # seconds with no hit from any tool = a gap row
LOW_CONFIDENCE = 75            # used by the decisions app to flag weak hits, not by this script
ROW_NAMESPACE = uuid.UUID("3349c065-a49c-4621-951d-26ea3045a941")


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


def chunk_order_score(hits, mapping, total):
    ordered = sorted(((mapping[pos], a, t) for pos, a, t in hits if pos < total), key=lambda x: x[0])
    return sum(1 for i in range(1, len(ordered)) if ordered[i][1:] == ordered[i - 1][1:])


def chunk_order(hits, total):
    identity = list(range(total))
    repaired = real_index_map(total)
    if chunk_order_score(hits, repaired, total) > chunk_order_score(hits, identity, total):
        return repaired, "repaired"
    return identity, "plain"


def ripthatset_runs(log, total):
    hits = ripthatset_hits(log)
    order, _ = chunk_order(hits, total)
    mapped = sorted((order[pos], a, t) for pos, a, t in hits if pos < total)
    runs = []
    last = {}
    for idx, a, t in mapped:
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
             "count": r["count"], "conf": None} for r in runs if r["count"] >= MIN_RUN_COUNT]


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


def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def finalize_row(kind, earliest, best, latest, variants):
    base = {"kind": kind, "earliest": earliest, "best": best, "latest": latest, "variants": variants}
    sha = hashlib.sha256(canon(base).encode()).hexdigest()
    rid = str(uuid.uuid5(ROW_NAMESPACE, sha))
    return {"uuid": rid, "sha": sha, **base}


def variant_score(v):
    r = sum(e["count"] for e in v["R"])
    tn = len(v["T"])
    conf = max((e["conf"] for e in v["T"]), default=0)
    return r * 3 + tn * 5 + conf / 20


def variant_best_start(v):
    runs = sorted(v["R"], key=lambda e: -e["count"])
    return runs[0]["start"] if runs else v["start"]


def build_variant(title, artist, v):
    return {
        "title": title,
        "artist": artist,
        "start": v["start"],
        "end": v["end"],
        "tracklistify": [{"start": e["start"], "confidence": e["conf"], "links": e.get("links", {})} for e in v["T"]],
        "ripthatset": [{"start": e["start"], "end": e["end"], "count": e["count"]} for e in v["R"]],
    }


def track_row(t):
    variants = [build_variant(title, t["artist"], v) for title, v in t["variants"].items()]
    best_variant = max(t["variants"].values(), key=variant_score)
    best = variant_best_start(best_variant)
    return finalize_row("track", t["start"], best, t["end"], variants)


def gap_row(start, end):
    return finalize_row("gap", start, start, end, [])


def build_rows(tracks, duration_seconds):
    rows = []
    prev_end = 0
    for t in tracks:
        if t["start"] - prev_end >= GAP_ROW_SECONDS:
            rows.append(gap_row(prev_end, t["start"]))
        rows.append(track_row(t))
        prev_end = max(prev_end, t["end"])
    if duration_seconds - prev_end >= GAP_ROW_SECONDS:
        rows.append(gap_row(prev_end, duration_seconds))
    return rows


def sha256_file(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def latest_merged(out_dir):
    if not os.path.isdir(out_dir):
        return None
    files = sorted(f for f in os.listdir(out_dir) if f.endswith(".json"))
    if not files:
        return None
    return json.load(open(os.path.join(out_dir, files[-1])))


def write_merged(out_dir, vid, doc):
    os.makedirs(out_dir, exist_ok=True)
    for _ in range(5):
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        out_path = os.path.join(out_dir, f"{ts}-{vid}.json")
        if not os.path.exists(out_path):
            break
        time.sleep(1)
    else:
        print("error: could not allocate a unique output filename", file=sys.stderr)
        sys.exit(1)
    with open(out_path, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    return out_path


def main():
    args = sys.argv[1:]
    force = "--force" in args
    positional = [a for a in args if a != "--force"]
    if not positional:
        print("error: video id is required\nusage: merge-results.py <video-id> [--force]", file=sys.stderr)
        sys.exit(1)
    vid = positional[0]

    data_dir = os.environ.get("SETBRAINZ_DATA_DIR", "data")
    runs_dir = os.path.join(data_dir, "runs", vid)
    tracklist_path = os.path.join(runs_dir, "tracklistify", "tracklist.json")
    log_path = os.path.join(runs_dir, "ripthatset", "run.log")
    if not os.path.exists(tracklist_path) or not os.path.exists(log_path):
        print(f"error: no run data for video id {vid!r} under {runs_dir}", file=sys.stderr)
        sys.exit(1)

    total = int(re.search(r"Processing (\d+) segments", open(log_path, errors="replace").read()).group(1))
    _, order_label = chunk_order(ripthatset_hits(log_path), total)
    print(f"chunk order: {order_label}", file=sys.stderr)

    events = tracklistify_hits(tracklist_path) + ripthatset_runs(log_path, total)
    tracks = merge(events)
    rows = build_rows(tracks, total * SEG)

    out_dir = os.path.join(data_dir, "merged", vid)
    prev = latest_merged(out_dir)
    if prev is not None and not force:
        if [r["sha"] for r in prev["rows"]] == [r["sha"] for r in rows]:
            print("warning: no changes since the last merge; nothing written", file=sys.stderr)
            return

    doc = {
        "videoId": vid,
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "durationSeconds": total * SEG,
        "inputs": {
            os.path.relpath(tracklist_path, data_dir): {"sha256": sha256_file(tracklist_path)},
            os.path.relpath(log_path, data_dir): {"sha256": sha256_file(log_path)},
        },
        "params": {
            "seg": SEG,
            "continuationGapSeconds": GAP,
            "maxChunkGap": MAX_SEG_GAP,
            "minRipThatSetRunCount": MIN_RUN_COUNT,
            "gapRowSeconds": GAP_ROW_SECONDS,
            "lowConfidence": LOW_CONFIDENCE,
            "chunkOrder": order_label,
        },
        "rows": rows,
    }
    out_path = write_merged(out_dir, vid, doc)
    print(f"wrote {len(rows)} rows to {out_path}")


if __name__ == "__main__":
    main()
