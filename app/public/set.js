const LOW_CONFIDENCE = 75

let player = null

function videoIdFromPath() {
  const parts = location.pathname.split('/')
  return decodeURIComponent(parts[parts.length - 1])
}

const VIDEO_ID = videoIdFromPath()

function hms(seconds) {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':')
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

function variantStats(variant) {
  const r = variant.ripthatset.reduce((sum, run) => sum + run.count, 0)
  const t = variant.tracklistify.length
  const conf = t ? Math.max(...variant.tracklistify.map((hit) => hit.confidence)) : null
  return { r, t, conf }
}

function variantScore(variant) {
  const { r, t, conf } = variantStats(variant)
  return r * 3 + t * 5 + (conf || 0) / 20
}

function variantBestStart(variant) {
  const runs = [...variant.ripthatset].sort((a, b) => b.count - a.count)
  return runs.length ? runs[0].start : variant.start
}

function variantEvidence(variant) {
  const { r, t, conf } = variantStats(variant)
  const bits = []
  if (t) bits.push(`T ${t}× ${Math.round(conf)}%`)
  if (r) bits.push(`R ${r} chunks`)
  return bits.join(' · ')
}

function variantLinks(variant) {
  const q = encodeURIComponent(`${variant.title} ${variant.artist}`)
  const links = [
    ['Spotify', `https://open.spotify.com/search/${q}`],
    ['YT Music', `https://music.youtube.com/search?q=${q}`],
  ]
  const seen = new Set()
  for (const hit of variant.tracklistify) {
    for (const [key, url] of Object.entries(hit.links || {})) {
      if (!url || key.endsWith('_search') || seen.has(key)) continue
      seen.add(key)
      const label = key.charAt(0).toUpperCase() + key.slice(1)
      links.push([`${label} ✓`, url])
    }
  }
  return links.map(([name, url]) => `<a href="${escapeHtml(url)}" target="_blank">${escapeHtml(name)}</a>`).join(' ')
}

function jumpLink(seconds, css) {
  const t = Math.max(0, Math.round(seconds))
  return `<a class="jump-link ${css}" href="#" data-t="${t}">${hms(t)}</a>`
}

function decidedMark(row) {
  return row.track ? '<span class="decided-mark">✓</span>' : ''
}

function buildMissingRow() {
  return `<tr class="row-gap">
<td class="jump">${jumpLink(0, 'big')}</td>
<td><b>(no merged data)</b></td>
<td class="alts"></td>
<td class="small"></td></tr>`
}

function buildGapRow(row, index) {
  const sources = row.merged
  const earliest = Math.min(...sources.map((m) => m.earliest))
  const latest = Math.max(...sources.map((m) => m.latest))
  const big = index === 0 ? 0 : Math.max(0, earliest - 5)
  const span = Math.round(latest - earliest)
  const minutes = Math.floor(span / 60)
  const secs = span % 60
  return `<tr class="row-gap${row.track ? ' decided' : ''}">
<td class="jump">${jumpLink(big, 'big')}
<div class="small">${jumpLink(earliest, 'earliest')} — ${jumpLink(latest, 'latest')}</div></td>
<td>${decidedMark(row)}<b>ID</b><div class="small">${minutes} min ${secs} s with no match</div></td>
<td class="alts"></td>
<td class="small"></td></tr>`
}

function buildTrackRow(row, index) {
  const sources = row.merged.filter((m) => m.kind === 'track')
  const scored = sources
    .flatMap((m) => m.variants)
    .map((v) => ({ v, score: variantScore(v) }))
    .sort((a, b) => b.score - a.score)
  const primary = scored[0].v
  const alts = scored.slice(1).map((s) => s.v)
  const { r, t, conf } = variantStats(primary)
  const weak = (conf !== null && conf < LOW_CONFIDENCE) || (r === 0 && t === 1)
  const cls = weak ? 'row-weak' : (r && t ? 'row-both' : 'row-one')

  const earliest = Math.min(...sources.map((m) => m.earliest))
  const latest = Math.max(...sources.map((m) => m.latest))
  const best = variantBestStart(primary)
  const big = index === 0 ? 0 : Math.max(0, earliest - 5)

  const titleHtml = weak
    ? `ID <small>maybe ${escapeHtml(primary.title)}</small>`
    : escapeHtml(primary.title)
  const confSuffix = conf !== null ? ` (${Math.round(conf)}%)` : ''

  const altsHtml = alts
    .map((v) => `${escapeHtml(v.title)} <span class="small">${variantEvidence(v)} · ${hms(v.start)}–${hms(v.end)}</span>`)
    .join('<br>')

  return `<tr class="${cls}${row.track ? ' decided' : ''}">
<td class="jump">${jumpLink(big, 'big')}
<div class="small">${jumpLink(earliest, 'earliest')} ${jumpLink(best, 'best')} ${jumpLink(latest, 'latest')}</div></td>
<td>${decidedMark(row)}<b>${titleHtml}</b><div class="small">${escapeHtml(primary.artist)}${confSuffix}</div><div class="small ev">${variantEvidence(primary)}</div></td>
<td class="alts">${altsHtml}</td>
<td class="small">${variantLinks(primary)}</td></tr>`
}

function buildRowHtml(row, index) {
  if (!row.merged.length) return buildMissingRow()
  const hasTrack = row.merged.some((m) => m.kind === 'track')
  return hasTrack ? buildTrackRow(row, index) : buildGapRow(row, index)
}

window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
  player = new YT.Player('yt', { videoId: VIDEO_ID, width: 640, height: 360 })
}

$(document).on('click', 'a.jump-link', function (e) {
  e.preventDefault()
  if (!player || typeof player.seekTo !== 'function') return
  player.seekTo(Number($(this).data('t')), true)
  player.playVideo()
})

$.getJSON(`/api/sets/${encodeURIComponent(VIDEO_ID)}`, (data) => {
  const $tbody = $('#tracklist tbody')
  data.rows.forEach((row, index) => $tbody.append(buildRowHtml(row, index)))
})
