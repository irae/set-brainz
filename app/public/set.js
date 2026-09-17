let player = null

function videoIdFromPath() {
  const parts = location.pathname.split('/')
  return decodeURIComponent(parts[parts.length - 1])
}

const VIDEO_ID = videoIdFromPath()
const GRAB_LINK_HTML = '<a href="#" class="grab-link">grab</a>'
const UNDO_LINK_HTML = '<a href="#" class="undo-link">undo</a>'
const POSITION_KEY = `sb-position:${VIDEO_ID}`

function loadSavedPosition() {
  try {
    const raw = localStorage.getItem(POSITION_KEY)
    if (raw === null) return null
    const seconds = Number(raw)
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
  } catch {
    return null
  }
}

function savePosition(seconds) {
  try {
    localStorage.setItem(POSITION_KEY, String(Math.max(0, Math.round(seconds))))
  } catch {}
}

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

function variantEvidence(variant) {
  const { r, t, conf } = variantStats(variant)
  const bits = []
  if (t) bits.push(`T ${t}× ${Math.round(conf)}%`)
  if (r) bits.push(`R ${r} chunks`)
  return bits.join(' · ')
}

function searchLinksHtml(title, artist) {
  const t = (title || '').trim()
  const a = (artist || '').trim()
  if (!t && !a) return ''
  const q = encodeURIComponent(`${t} ${a}`.trim())
  const links = [
    ['Spotify', `https://open.spotify.com/search/${q}`],
    ['YT Music', `https://music.youtube.com/search?q=${q}`],
  ]
  return links.map(([name, url]) => `<a href="${escapeHtml(url)}" target="_blank">${escapeHtml(name)}</a>`).join(' ')
}

function variantLinks(variant) {
  const search = searchLinksHtml(variant.title, variant.artist)
  const direct = []
  const seen = new Set()
  for (const hit of variant.tracklistify) {
    for (const [key, url] of Object.entries(hit.links || {})) {
      if (!url || key.endsWith('_search') || seen.has(key)) continue
      seen.add(key)
      const label = key.charAt(0).toUpperCase() + key.slice(1)
      direct.push(`<a href="${escapeHtml(url)}" target="_blank">${escapeHtml(`${label} ✓`)}</a>`)
    }
  }
  return [search, ...direct].filter(Boolean).join(' ')
}

function linksSpan(html) {
  return html ? `<span class="search-links">${html}</span>` : ''
}

function jumpLink(seconds, css) {
  const t = Math.max(0, Math.round(seconds))
  return `<a class="jump-link ${css}" href="#" data-t="${t}">${hms(t)}</a>`
}

function decidedMark(row) {
  return row.track ? '<span class="decided-mark">✓</span>' : ''
}

function rowReady(row) {
  if (row.start === null || !row.track) return false
  const track = row.track
  if (track.isId) return true
  return !!(track.artists && track.artists.trim() && track.title && track.title.trim())
}

function rowClasses(row, baseClass) {
  const classes = [baseClass]
  if (row.track) classes.push('decided')
  if (rowReady(row)) classes.push('row-ready')
  return classes.join(' ')
}

function trackDisplay(row, guessTitleHtml, guessArtistHtml) {
  if (row.track) {
    return {
      titleHtml: escapeHtml(row.track.title || 'ID'),
      artistHtml: row.track.artists ? escapeHtml(row.track.artists) : '',
    }
  }
  return { titleHtml: guessTitleHtml, artistHtml: guessArtistHtml || '' }
}

function openDialogSpan(title, artists) {
  const attrs = artists !== undefined
    ? ` data-artists="${escapeHtml(artists)}" data-title="${escapeHtml(title)}"`
    : ''
  return `<span class="open-dialog"${attrs}>`
}

function ownTitleSpan(row, title, artists) {
  if (row.track) {
    return `<span class="open-dialog" data-track="${escapeHtml(JSON.stringify(row.track))}" data-note="${escapeHtml(row.note || '')}">`
  }
  return openDialogSpan(title, artists)
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
  const smallLine = decided ? `<div class="small">${UNDO_LINK_HTML}</div>` : ''
  const { titleHtml, artistHtml } = trackDisplay(row, 'ID', '')
  const linksHtml = row.track ? linksSpan(searchLinksHtml(row.track.title, row.track.artists)) : ''
  return `<tr class="${rowClasses(row, 'row-gap')}" data-row-id="${row.id}">
<td class="jump">${jumpHtml}${GRAB_LINK_HTML}${smallLine}</td>
<td>${decidedMark(row)}<b>${ownTitleSpan(row)}${titleHtml}</span></b>${linksHtml}${artistHtml ? `<div class="small">${artistHtml}</div>` : ''}
${rowActionsHtml()}</td>
<td class="alts"></td></tr>`
}

function buildGapRow(row, index) {
  const sources = row.merged
  const earliest = Math.min(...sources.map((m) => m.earliest))
  const latest = Math.max(...sources.map((m) => m.latest))
  const defaultBig = index === 0 ? 0 : Math.max(0, earliest - 5)
  const decided = row.start !== null
  const bigSeconds = decided ? row.start.seconds : defaultBig
  const bigCss = decided ? 'big decided' : 'big'
  const smallLine = decided
    ? `<div class="small">${UNDO_LINK_HTML}</div>`
    : `<div class="small">${jumpLink(earliest, 'earliest')} — ${jumpLink(latest, 'latest')}</div>`
  const span = Math.round(latest - earliest)
  const minutes = Math.floor(span / 60)
  const secs = span % 60
  const { titleHtml } = trackDisplay(row, 'ID', '')
  const linksHtml = row.track ? linksSpan(searchLinksHtml(row.track.title, row.track.artists)) : ''
  return `<tr class="${rowClasses(row, 'row-gap')}" data-row-id="${row.id}">
<td class="jump">${jumpLink(bigSeconds, bigCss)}${GRAB_LINK_HTML}
${smallLine}</td>
<td>${decidedMark(row)}<b>${ownTitleSpan(row)}${titleHtml}</span></b>${linksHtml}<div class="small">${minutes} min ${secs} s with no match</div>
${rowActionsHtml()}</td>
<td class="alts"></td></tr>`
}

function buildTrackRow(row, index, lowConfidence) {
  const sources = row.merged.filter((m) => m.kind === 'track')
  const scored = sources
    .flatMap((m) => m.variants.map((v) => ({ v, m, score: variantScore(v) })))
    .sort((a, b) => b.score - a.score)
  const primary = scored[0].v
  const alts = scored.slice(1).map((s) => s.v)
  const { r, t, conf } = variantStats(primary)
  const weak = (conf !== null && conf < lowConfidence) || (r === 0 && t === 1)
  const cls = weak ? 'row-weak' : (r && t ? 'row-both' : 'row-one')

  const earliest = Math.min(...sources.map((m) => m.earliest))
  const latest = Math.max(...sources.map((m) => m.latest))
  const best = scored[0].m.best
  const defaultBig = index === 0 ? 0 : Math.max(0, earliest - 5)
  const decided = row.start !== null
  const bigSeconds = decided ? row.start.seconds : defaultBig
  const bigCss = decided ? 'big decided' : 'big'
  const smallLine = decided
    ? `<div class="small">${UNDO_LINK_HTML}</div>`
    : `<div class="small">${jumpLink(earliest, 'earliest')} ${jumpLink(best, 'best')} ${jumpLink(latest, 'latest')}</div>`

  const guessTitleHtml = weak
    ? `ID <small>maybe ${escapeHtml(primary.title)}</small>`
    : escapeHtml(primary.title)
  const confSuffix = conf !== null ? ` (${Math.round(conf)}%)` : ''
  const { titleHtml, artistHtml } = trackDisplay(row, guessTitleHtml, `${escapeHtml(primary.artist)}${confSuffix}`)

  const altsHtml = alts
    .map((v) => `${openDialogSpan(v.title, v.artist)}${escapeHtml(v.title)}</span>${linksSpan(variantLinks(v))}<br><span class="small">${variantEvidence(v)} · ${hms(v.start)}–${hms(v.end)}</span>`)
    .join('<br>')

  const titleLinksHtml = row.track
    ? linksSpan(searchLinksHtml(row.track.title, row.track.artists))
    : linksSpan(variantLinks(primary))

  return `<tr class="${rowClasses(row, cls)}" data-row-id="${row.id}">
<td class="jump">${jumpLink(bigSeconds, bigCss)}${GRAB_LINK_HTML}
${smallLine}</td>
<td>${decidedMark(row)}<b>${ownTitleSpan(row, primary.title, primary.artist)}${titleHtml}</span></b>${titleLinksHtml}<div class="small">${artistHtml}</div><div class="small ev">${variantEvidence(primary)}</div>
${rowActionsHtml()}</td>
<td class="alts">${altsHtml}</td></tr>`
}

function buildRowHtml(row, index, lowConfidence) {
  if (!row.merged.length) return buildEmptyRow(row, index)
  const hasTrack = row.merged.some((m) => m.kind === 'track')
  return hasTrack ? buildTrackRow(row, index, lowConfidence) : buildGapRow(row, index)
}

let positionTimer = null
let restoringPosition = 0

function startPositionTimer() {
  if (positionTimer) return
  positionTimer = setInterval(() => {
    if (player && typeof player.getCurrentTime === 'function') savePosition(player.getCurrentTime())
  }, 2000)
}

function stopPositionTimer() {
  if (!positionTimer) return
  clearInterval(positionTimer)
  positionTimer = null
}

function onPlayerReady() {
  const saved = loadSavedPosition()
  if (!saved) return
  restoringPosition = saved
  player.mute()
  player.playVideo()
  setTimeout(() => {
    if (!restoringPosition) return
    restoringPosition = 0
    if (player && typeof player.unMute === 'function') player.unMute()
  }, 4000)
}

function onPlayerStateChange(e) {
  if (restoringPosition) {
    if (e.data === YT.PlayerState.PLAYING) {
      player.seekTo(restoringPosition, true)
      player.pauseVideo()
    } else if (e.data === YT.PlayerState.PAUSED) {
      restoringPosition = 0
      player.unMute()
    }
    return
  }
  if (e.data === YT.PlayerState.PLAYING) {
    startPositionTimer()
    return
  }
  stopPositionTimer()
  if (e.data === YT.PlayerState.PAUSED && player && typeof player.getCurrentTime === 'function') {
    savePosition(player.getCurrentTime())
  }
}

window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
  player = new YT.Player('yt', {
    videoId: VIDEO_ID,
    width: 640,
    height: 360,
    events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange },
  })
}

function apiUrl(rowId, suffix) {
  return `/api/sets/${encodeURIComponent(VIDEO_ID)}/rows/${encodeURIComponent(rowId)}${suffix || ''}`
}

function loadAndRender() {
  $.getJSON(`/api/sets/${encodeURIComponent(VIDEO_ID)}`)
    .done((data) => {
      $('.note').remove()
      hoveredRow = null
      const $tbody = $('#tracklist tbody')
      $tbody.empty()
      data.rows.forEach((row, index) => $tbody.append(buildRowHtml(row, index, data.params.lowConfidence)))
    })
    .fail(() => {
      showMessage('Could not load this set. Check the server, then reload the page.')
    })
}

function withStatus(text, jqXHR) {
  const status = jqXHR && jqXHR.status
  return status ? `${text} (status ${status})` : text
}

function saveStart(rowId, seconds, from) {
  $.ajax({
    url: apiUrl(rowId),
    method: 'PATCH',
    contentType: 'application/json',
    data: JSON.stringify({ start: { seconds, from } }),
  }).done(loadAndRender).fail((jqXHR) => showMessage(withStatus('Could not save the start. Check the server, then reload the page.', jqXHR)))
}

function clearStart(rowId) {
  $.ajax({
    url: apiUrl(rowId),
    method: 'PATCH',
    contentType: 'application/json',
    data: JSON.stringify({ start: null }),
  }).done(loadAndRender).fail((jqXHR) => showMessage(withStatus('Could not clear the start. Check the server, then reload the page.', jqXHR)))
}

function mergeRowApi(rowId, direction) {
  $.ajax({
    url: apiUrl(rowId, '/merge'),
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ direction }),
  }).done(loadAndRender).fail((jqXHR) => showMessage(withStatus('Could not merge that row.', jqXHR)))
}

function insertRowApi(rowId, position) {
  $.ajax({
    url: apiUrl(rowId, '/insert'),
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ position }),
  }).done(loadAndRender).fail((jqXHR) => showMessage(withStatus('Could not add that row.', jqXHR)))
}

function deleteRowApi(rowId) {
  $.ajax({ url: apiUrl(rowId), method: 'DELETE' })
    .done(loadAndRender).fail((jqXHR) => showMessage(withStatus('Could not delete that row.', jqXHR)))
}

function rowIdOf($el) {
  return $el.closest('tr').data('row-id')
}

let hoveredRow = null
let shiftHeld = false
let hasStartedPlayback = false

function applyShiftHover() {
  $('tr.shift-hover').removeClass('shift-hover')
  if (shiftHeld && hoveredRow) hoveredRow.addClass('shift-hover')
}

$(document).on('keydown', (e) => {
  if (e.key !== 'Shift') return
  $('body').addClass('shift-down')
  shiftHeld = true
  applyShiftHover()
})
$(document).on('keyup', (e) => {
  if (e.key !== 'Shift') return
  $('body').removeClass('shift-down')
  shiftHeld = false
  applyShiftHover()
})
$(window).on('blur', () => {
  $('body').removeClass('shift-down')
  shiftHeld = false
  applyShiftHover()
})

$(document).on('keydown', (e) => {
  if (e.code !== 'Space' && e.key !== ' ') return
  const dialogEl = document.getElementById('track-dialog')
  const targetTag = e.target && e.target.tagName
  if (dialogEl.open) return
  if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return
  if (e.target && e.target.isContentEditable) return
  e.preventDefault()
  if (!player || typeof player.getPlayerState !== 'function') return
  if (player.getPlayerState() === YT.PlayerState.PLAYING) {
    player.pauseVideo()
  } else {
    player.playVideo()
  }
  if (typeof player.getIframe === 'function') {
    const iframe = player.getIframe()
    if (iframe && typeof iframe.focus === 'function') iframe.focus()
  }
})

$(document).on('mouseenter mousemove', 'tr', function (e) {
  hoveredRow = $(this)
  shiftHeld = e.shiftKey
  applyShiftHover()
})
$(document).on('mouseleave', 'tr', function () {
  hoveredRow = null
  applyShiftHover()
})

$(document).on('click', 'a.jump-link', function (e) {
  e.preventDefault()
  const $el = $(this)
  const seconds = Number($el.data('t'))
  if (e.shiftKey) {
    const from = ['earliest', 'best', 'latest'].find((cls) => $el.hasClass(cls))
    if (from) {
      saveStart(rowIdOf($el), seconds, from)
    } else if ($el.hasClass('big')) {
      saveStart(rowIdOf($el), seconds, 'big')
    }
    return
  }
  if (!player || typeof player.seekTo !== 'function') return
  player.seekTo(seconds, true)
  if (!hasStartedPlayback) {
    player.playVideo()
    hasStartedPlayback = true
  }
  savePosition(seconds)
})

$(document).on('click', 'a.undo-link', function (e) {
  e.preventDefault()
  clearStart(rowIdOf($(this)))
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

function openDialog(rowId, fields) {
  const dialogEl = document.getElementById('track-dialog')
  dialogEl.returnValue = ''
  dialogEl.dataset.rowId = rowId
  const $dialog = $(dialogEl)
  $dialog.find('[name=artists]').val(fields.artists || '')
  $dialog.find('[name=title]').val(fields.title || '')
  $dialog.find('[name=version]').val(fields.version || '')
  $dialog.find('[name=label]').val(fields.label || '')
  $dialog.find('[name=isId]').prop('checked', !!fields.isId)
  $dialog.find('[name=isIdVersion]').prop('checked', !!fields.isIdVersion)
  $dialog.find('[name=stackedWithPrevious]').prop('checked', !!fields.stackedWithPrevious)
  $dialog.find('[name=note]').val(fields.note || '')
  dialogEl.showModal()
}

$(document).on('click', '.open-dialog', function () {
  const $el = $(this)
  const rowId = rowIdOf($el)
  const track = $el.data('track')
  if (track) {
    openDialog(rowId, { ...track, note: $el.data('note') })
  } else {
    openDialog(rowId, { artists: $el.data('artists'), title: $el.data('title') })
  }
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
    isIdVersion: $dialog.find('[name=isIdVersion]').prop('checked'),
    stackedWithPrevious: $dialog.find('[name=stackedWithPrevious]').prop('checked'),
  }
  const note = $dialog.find('[name=note]').val().trim()
  $.ajax({
    url: apiUrl(rowId),
    method: 'PATCH',
    contentType: 'application/json',
    data: JSON.stringify({ track, note }),
  }).done(loadAndRender).fail((jqXHR) => showMessage(withStatus('Could not save the track. Check the server, then reload the page.', jqXHR)))
})

loadAndRender()
