let player = null

function videoIdFromPath() {
  const parts = location.pathname.split('/')
  return decodeURIComponent(parts[parts.length - 1])
}

const VIDEO_ID = videoIdFromPath()
const GRAB_LINK_HTML = '<a href="#" class="grab-link">grab</a>'

function showMessage(text) {
  $('.note').remove()
  $('#tracklist').before(`<p class="note">${escapeHtml(text)}</p>`)
}

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

function openDialogSpan(title, artists) {
  const attrs = artists !== undefined
    ? ` data-artists="${escapeHtml(artists)}" data-title="${escapeHtml(title)}"`
    : ''
  return `<span class="open-dialog"${attrs}>`
}

function rowActionsHtml() {
  return '<span class="row-actions">'
    + '<a href="#" class="action-merge-up">merge with above</a> '
    + '<a href="#" class="action-merge-down">merge with below</a> '
    + '<a href="#" class="action-insert-above">add empty above</a> '
    + '<a href="#" class="action-insert-below">add empty below</a> '
    + '<a href="#" class="action-delete">delete row</a>'
    + '</span>'
}

function buildEmptyRow(row, index) {
  const decided = row.start !== null
  const jumpHtml = decided
    ? jumpLink(row.start.seconds, 'big decided')
    : index === 0 ? jumpLink(0, 'big') : '<span class="jump-link big">—</span>'
  const titleHtml = row.track !== null ? escapeHtml(row.track.title || 'ID') : 'ID'
  const artistHtml = row.track !== null && row.track.artists ? `<div class="small">${escapeHtml(row.track.artists)}</div>` : ''
  return `<tr class="row-gap${row.track ? ' decided' : ''}" data-row-id="${row.id}">
<td class="jump">${jumpHtml}${GRAB_LINK_HTML}</td>
<td>${decidedMark(row)}<b>${openDialogSpan()}${titleHtml}</span></b>${artistHtml}
${rowActionsHtml()}</td>
<td class="alts"></td>
<td class="small"></td></tr>`
}

function buildGapRow(row, index) {
  const sources = row.merged
  const earliest = Math.min(...sources.map((m) => m.earliest))
  const latest = Math.max(...sources.map((m) => m.latest))
  const defaultBig = index === 0 ? 0 : Math.max(0, earliest - 5)
  const decided = row.start !== null
  const bigSeconds = decided ? row.start.seconds : defaultBig
  const bigCss = decided ? 'big decided' : 'big'
  const wasBigLink = decided ? ` ${jumpLink(defaultBig, 'was-big')}` : ''
  const span = Math.round(latest - earliest)
  const minutes = Math.floor(span / 60)
  const secs = span % 60
  return `<tr class="row-gap${row.track ? ' decided' : ''}" data-row-id="${row.id}">
<td class="jump">${jumpLink(bigSeconds, bigCss)}${GRAB_LINK_HTML}
<div class="small">${jumpLink(earliest, 'earliest')} — ${jumpLink(latest, 'latest')}${wasBigLink}</div></td>
<td>${decidedMark(row)}<b>${openDialogSpan()}ID</span></b><div class="small">${minutes} min ${secs} s with no match</div>
${rowActionsHtml()}</td>
<td class="alts"></td>
<td class="small"></td></tr>`
}

function buildTrackRow(row, index, lowConfidence) {
  const sources = row.merged.filter((m) => m.kind === 'track')
  const scored = sources
    .flatMap((m) => m.variants)
    .map((v) => ({ v, score: variantScore(v) }))
    .sort((a, b) => b.score - a.score)
  const primary = scored[0].v
  const alts = scored.slice(1).map((s) => s.v)
  const { r, t, conf } = variantStats(primary)
  const weak = (conf !== null && conf < lowConfidence) || (r === 0 && t === 1)
  const cls = weak ? 'row-weak' : (r && t ? 'row-both' : 'row-one')

  const earliest = Math.min(...sources.map((m) => m.earliest))
  const latest = Math.max(...sources.map((m) => m.latest))
  const best = variantBestStart(primary)
  const defaultBig = index === 0 ? 0 : Math.max(0, earliest - 5)
  const decided = row.start !== null
  const bigSeconds = decided ? row.start.seconds : defaultBig
  const bigCss = decided ? 'big decided' : 'big'
  const wasBigLink = decided ? ` ${jumpLink(defaultBig, 'was-big')}` : ''

  const titleHtml = weak
    ? `ID <small>maybe ${escapeHtml(primary.title)}</small>`
    : escapeHtml(primary.title)
  const confSuffix = conf !== null ? ` (${Math.round(conf)}%)` : ''

  const altsHtml = alts
    .map((v) => `${openDialogSpan(v.title, v.artist)}${escapeHtml(v.title)}</span> <span class="small">${variantEvidence(v)} · ${hms(v.start)}–${hms(v.end)}</span>`)
    .join('<br>')

  return `<tr class="${cls}${row.track ? ' decided' : ''}" data-row-id="${row.id}">
<td class="jump">${jumpLink(bigSeconds, bigCss)}${GRAB_LINK_HTML}
<div class="small">${jumpLink(earliest, 'earliest')} ${jumpLink(best, 'best')} ${jumpLink(latest, 'latest')}${wasBigLink}</div></td>
<td>${decidedMark(row)}<b>${openDialogSpan(primary.title, primary.artist)}${titleHtml}</span></b><div class="small">${escapeHtml(primary.artist)}${confSuffix}</div><div class="small ev">${variantEvidence(primary)}</div>
${rowActionsHtml()}</td>
<td class="alts">${altsHtml}</td>
<td class="small">${variantLinks(primary)}</td></tr>`
}

function buildRowHtml(row, index, lowConfidence) {
  if (!row.merged.length) return buildEmptyRow(row, index)
  const hasTrack = row.merged.some((m) => m.kind === 'track')
  return hasTrack ? buildTrackRow(row, index, lowConfidence) : buildGapRow(row, index)
}

window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
  player = new YT.Player('yt', { videoId: VIDEO_ID, width: 640, height: 360 })
}

function apiUrl(rowId, suffix) {
  return `/api/sets/${encodeURIComponent(VIDEO_ID)}/rows/${encodeURIComponent(rowId)}${suffix || ''}`
}

function loadAndRender() {
  $.getJSON(`/api/sets/${encodeURIComponent(VIDEO_ID)}`)
    .done((data) => {
      $('.note').remove()
      const $tbody = $('#tracklist tbody')
      $tbody.empty()
      data.rows.forEach((row, index) => $tbody.append(buildRowHtml(row, index, data.params.lowConfidence)))
    })
    .fail(() => {
      showMessage('Could not load this set. Check the server, then reload the page.')
    })
}

function saveStart(rowId, seconds, from) {
  $.ajax({
    url: apiUrl(rowId),
    method: 'PATCH',
    contentType: 'application/json',
    data: JSON.stringify({ start: { seconds, from } }),
  }).done(loadAndRender).fail(() => showMessage('Could not save the start. Check the server, then reload the page.'))
}

function mergeRowApi(rowId, direction) {
  $.ajax({
    url: apiUrl(rowId, '/merge'),
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ direction }),
  }).done(loadAndRender).fail(() => showMessage('Could not merge that row.'))
}

function insertRowApi(rowId, position) {
  $.ajax({
    url: apiUrl(rowId, '/insert'),
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ position }),
  }).done(loadAndRender).fail(() => showMessage('Could not add that row.'))
}

function deleteRowApi(rowId) {
  $.ajax({ url: apiUrl(rowId), method: 'DELETE' })
    .done(loadAndRender).fail(() => showMessage('Could not delete that row.'))
}

function rowIdOf($el) {
  return $el.closest('tr').data('row-id')
}

$(document).on('keydown', (e) => {
  if (e.key === 'Shift') $('body').addClass('shift-down')
})
$(document).on('keyup', (e) => {
  if (e.key === 'Shift') $('body').removeClass('shift-down')
})
$(window).on('blur', () => {
  $('body').removeClass('shift-down')
})

$(document).on('click', 'a.jump-link', function (e) {
  e.preventDefault()
  const $el = $(this)
  const seconds = Number($el.data('t'))
  if (e.shiftKey) {
    const from = ['earliest', 'best', 'latest'].find((cls) => $el.hasClass(cls))
    if (from) {
      saveStart(rowIdOf($el), seconds, from)
      return
    }
  }
  if (!player || typeof player.seekTo !== 'function') return
  player.seekTo(seconds, true)
  player.playVideo()
})

$(document).on('click', 'a.grab-link', function (e) {
  e.preventDefault()
  if (!player || typeof player.getPlayerState !== 'function') {
    showMessage('The player is not ready.')
    return
  }
  if (player.getPlayerState() !== YT.PlayerState.PAUSED) {
    showMessage('Pause the player, then grab its time.')
    return
  }
  saveStart(rowIdOf($(this)), player.getCurrentTime(), 'grab')
})

$(document).on('click', '.action-merge-up', function (e) {
  e.preventDefault()
  mergeRowApi(rowIdOf($(this)), 'up')
})
$(document).on('click', '.action-merge-down', function (e) {
  e.preventDefault()
  mergeRowApi(rowIdOf($(this)), 'down')
})
$(document).on('click', '.action-insert-above', function (e) {
  e.preventDefault()
  insertRowApi(rowIdOf($(this)), 'above')
})
$(document).on('click', '.action-insert-below', function (e) {
  e.preventDefault()
  insertRowApi(rowIdOf($(this)), 'below')
})
$(document).on('click', '.action-delete', function (e) {
  e.preventDefault()
  deleteRowApi(rowIdOf($(this)))
})

function openDialog(rowId, title, artists) {
  const dialogEl = document.getElementById('track-dialog')
  dialogEl.returnValue = ''
  dialogEl.dataset.rowId = rowId
  const $dialog = $(dialogEl)
  $dialog.find('[name=artists]').val(artists || '')
  $dialog.find('[name=title]').val(title || '')
  $dialog.find('[name=version]').val('')
  $dialog.find('[name=label]').val('')
  $dialog.find('[name=isId]').prop('checked', false)
  $dialog.find('[name=isIdVersion]').val('')
  $dialog.find('[name=stackedWithPrevious]').prop('checked', false)
  $dialog.find('[name=note]').val('')
  dialogEl.showModal()
}

$(document).on('click', '.open-dialog', function () {
  const $el = $(this)
  openDialog(rowIdOf($el), $el.data('title'), $el.data('artists'))
})

document.getElementById('track-cancel').addEventListener('click', () => {
  document.getElementById('track-dialog').close('cancel')
})

document.getElementById('track-dialog').addEventListener('close', function () {
  if (this.returnValue !== 'save') return
  const rowId = this.dataset.rowId
  const $dialog = $(this)
  const track = {
    artists: $dialog.find('[name=artists]').val().trim(),
    title: $dialog.find('[name=title]').val().trim(),
    version: $dialog.find('[name=version]').val().trim(),
    label: $dialog.find('[name=label]').val().trim(),
    isId: $dialog.find('[name=isId]').prop('checked'),
    isIdVersion: $dialog.find('[name=isIdVersion]').val().trim(),
    stackedWithPrevious: $dialog.find('[name=stackedWithPrevious]').prop('checked'),
  }
  const note = $dialog.find('[name=note]').val().trim()
  $.ajax({
    url: apiUrl(rowId),
    method: 'PATCH',
    contentType: 'application/json',
    data: JSON.stringify({ track, note }),
  }).done(loadAndRender).fail(() => showMessage('Could not save the track. Check the server, then reload the page.'))
})

loadAndRender()
