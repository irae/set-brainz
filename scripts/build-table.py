#!/usr/bin/env python3
# Build results/tracklist.html: YouTube player on top, one row per track slot,
# jump links, best/alternative guesses, ID rows for gaps, and search links.
# Reads the same inputs as merge-results.py. Warns on odd data and continues.
# Usage: scripts/build-table.py <youtube-video-id>
import html, importlib.util, json, re, sys
from urllib.parse import quote

spec = importlib.util.spec_from_file_location("merge", "scripts/merge-results.py")
merge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merge)

VIDEO = sys.argv[1] if len(sys.argv) > 1 else "VIDEO_ID"
LOW_CONF = 75          # below this a hit is "ID, maybe <x>"
ID_GAP = 90            # seconds with no hit from any tool = ID row
warn = lambda m: print("warning:", m, file=sys.stderr)


def score(v):
    r = sum(e["count"] for e in v["R"])
    t = len(v["T"])
    conf = max((e["conf"] for e in v["T"]), default=None)
    return r * 3 + t * 5 + (conf or 0) / 20, r, t, conf


def evidence(v):
    _, r, t, conf = score(v)
    bits = []
    if t: bits.append(f"T {t}× {conf:.0f}%")
    if r: bits.append(f"R {r} chunks")
    return " · ".join(bits)


def links(title, artist, v):
    q = quote(f"{title} {artist}")
    out = {"Spotify": f"https://open.spotify.com/search/{q}",
           "YT Music": f"https://music.youtube.com/search?q={q}"}
    for e in v["T"]:
        l = e.get("links") or {}
        if l.get("spotify"): out["Spotify ✓"] = l["spotify"]
        if l.get("shazam"): out["Shazam"] = l["shazam"]
        if l.get("apple"): out["Apple"] = l["apple"]
    return " ".join(f'<a href="{html.escape(u)}" target="_blank">{n}</a>' for n, u in out.items())


def best_start(v):
    runs = sorted(v["R"], key=lambda e: -e["count"])
    return runs[0]["start"] if runs else v["start"]


def jump(t, label, cls=""):
    return f'<a class="j {cls}" href="#" data-t="{t}">{label}</a>'


def build_rows(tracks, total_len):
    rows, prev_end = [], 0
    for t in tracks:
        if t["start"] - prev_end > ID_GAP:
            rows.append(id_row(prev_end, t["start"]))
        variants = sorted(t["variants"].items(), key=lambda kv: -score(kv[1])[0])
        (btitle, bv), alts = variants[0], variants[1:]
        _, r, tn, conf = score(bv)
        weak = (conf is not None and conf < LOW_CONF) or (r == 0 and tn == 1)
        cls = "both" if r and tn else "one"
        title_html = html.escape(btitle)
        if weak:
            cls = "weak"
            title_html = f"ID <small>maybe {html.escape(btitle)}</small>"
        earliest, best, latest = t["start"], best_start(bv), t["end"]
        if not earliest <= best <= latest:
            warn(f"best {best} outside {earliest}-{latest} for {btitle}")
        pre = max(0, earliest - 5) if rows else 0
        rows.append(f"""<tr class="{cls}">
<td class="jump">{jump(pre, merge.hms(pre), "big")}
<div class="small">{jump(earliest, merge.hms(earliest), "early")} {jump(best, merge.hms(best), "best")} {jump(latest, merge.hms(latest), "late")}</div></td>
<td><b>{title_html}</b><div class="small">{html.escape(t["artist"])}{f" ({conf:.0f}%)" if conf else ""}</div><div class="small ev">{evidence(bv)}</div></td>
<td class="alts">{"<br>".join(f"{html.escape(k)} <span class='small'>{evidence(v)} · {merge.hms(v['start'])}–{merge.hms(v['end'])}</span>" for k, v in alts)}</td>
<td class="small">{links(btitle, t["artist"], bv)}</td></tr>""")
        prev_end = max(prev_end, t["end"])
    if total_len - prev_end > ID_GAP:
        rows.append(id_row(prev_end, total_len))
    return rows


def id_row(start, end):
    return f"""<tr class="id"><td class="jump">{jump(max(0, start - 5), merge.hms(max(0, start - 5)), "big")}
<div class="small">{jump(start, merge.hms(start), "early")} — {jump(end, merge.hms(end), "late")}</div></td>
<td><b>ID</b><div class="small">{int((end - start) // 60)} min {int((end - start) % 60)} s with no match</div></td><td></td><td></td></tr>"""


def main():
    log = "ripthatset-run.log"
    total = int(re.search(r"Processing (\d+) segments", open(log, errors="replace").read()).group(1))
    events = merge.tracklistify_hits("results/tracklist.json") + merge.ripthatset_runs(log, total)
    tracks = merge.merge(events)
    rows = build_rows(tracks, total * merge.SEG)
    page = f"""<!doctype html><meta charset="utf-8"><title>Tracklist</title>
<style>
body{{font-family:system-ui,sans-serif;margin:0;background:#111;color:#ddd}}
#player{{position:sticky;top:0;background:#000;z-index:1;text-align:center}}
table{{border-collapse:collapse;width:100%;font-size:14px}}
td{{padding:6px 8px;border-bottom:1px solid #333;vertical-align:top}}
tr.both{{background:#15241a}} tr.one{{background:#24220f}} tr.weak{{background:#2a1a12}} tr.id{{background:#301515}}
.small{{font-size:11px;color:#999;margin-top:2px}} .ev{{color:#777}}
a{{color:#8cf;text-decoration:none}} a.big{{font-size:18px;font-weight:bold;color:#fff}}
a.early{{color:#6af}} a.best{{color:#6d6}} a.late{{color:#999}}
.jump{{white-space:nowrap;width:120px}} .alts{{color:#bbb}}
</style>
<div id="player"><div id="yt"></div></div>
<table><tr><th>Jump</th><th>Track</th><th>Alternatives</th><th>Search</th></tr>
{chr(10).join(rows)}
</table>
<script src="https://www.youtube.com/iframe_api"></script>
<script>
let p;
function onYouTubeIframeAPIReady(){{p=new YT.Player('yt',{{videoId:'{VIDEO}',width:640,height:360}});}}
document.addEventListener('click',e=>{{const a=e.target.closest('a.j');if(!a)return;e.preventDefault();
p.seekTo(+a.dataset.t,true);p.playVideo();}});
</script>"""
    open("results/tracklist.html", "w").write(page)
    print(f"{len(rows)} rows written to results/tracklist.html")


main()
