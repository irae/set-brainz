let player = null
let audioPlayer = null
let playerInitialized = false
let sourceYoutubeId = null
let rowsById = new Map()

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
  const $toast = $(`<div class="toast">${escapeHtml(text)}<button type="button" class="toast-close">&times;</button></div>`)
  $('#toasts').append($toast)
}

$(document).on('click', '.toast-close', function () {
  $(this).closest('.toast').remove()
})

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
  return links.map(([name, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`).join(' ')
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
      direct.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(`${label} ✓`)}</a>`)
    }
  }
  return [search, ...direct].filter(Boolean).join(' ')
}

function confirmedLinkHtml(row) {
  const link = row.track && row.track.links && row.track.links[0]
  if (!link) return ''
  let url
  try {
    url = new URL(link.url)
  } catch {
    return ''
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
  const labels = url.hostname.replace(/^www\./, '').split('.')
  const twoPartSuffix = labels.length > 2 && labels[labels.length - 1].length === 2 && labels[labels.length - 2].length <= 3
  const name = { spotify: 'Spotify', youtubeMusic: 'YT Music', apple: 'Apple Music' }[link.kind]
    || labels[Math.max(0, labels.length - (twoPartSuffix ? 3 : 2))]
  return `<span class="search-links confirmed-link"><a href="${escapeHtml(url.href)}" target="_blank" rel="noopener">${escapeHtml(name)}</a></span>`
}

function linksSpan(html) {
  return html ? `<span class="search-links">${html}</span>` : ''
}

function jumpLink(seconds, css) {
  const t = Math.max(0, Math.round(seconds))
  return `<a class="jump-link ${css}" href="#" data-t="${t}">${hms(t)}</a>`
}

function decidedSmallLine(index) {
  const zeroLink = index === 0 ? `${jumpLink(0, 'was-big')} ` : ''
  return `<div class="small">${zeroLink}${UNDO_LINK_HTML}</div>`
}

function decidedMark(row) {
  return row.track ? '<span class="decided-mark">✓</span>' : ''
}

function rangeScoredVariants(row) {
  const own = new Set(row.merged.map((entry) => entry.uuid))
  return row.rangeEntries
    .filter((entry) => entry.kind === 'track')
    .flatMap((entry) => entry.variants.map((variant) => ({ variant, score: variantScore(variant), own: own.has(entry.uuid) })))
    .sort((a, b) => b.own - a.own || b.score - a.score)
}

function normalizedTrackText(text) {
  return String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function matchingSuggestion(row) {
  if (!row.track || row.track.isId) return null
  const title = normalizedTrackText(row.track.title)
  if (!title) return null
  const artist = normalizedTrackText(row.track.artists)
  return rangeScoredVariants(row).find(({ variant }) =>
    normalizedTrackText(variant.title) === title
    && (!row.track.artists?.trim() || normalizedTrackText(variant.artist) === artist),
  )?.variant || null
}

function winningSuggestionHtml(variant) {
  if (!variant) return ''
  return `<div class="guess winning-guess">${openDialogSpan(variant.title, variant.artist)}${escapeHtml(variant.title)}</span>${variant.artist ? ` <span class="small">${escapeHtml(variant.artist)}</span>` : ''}<div class="small">${jumpLink(variant.start, 'guess-time')}–${jumpLink(variant.end, 'guess-time')} ${variantEvidence(variant)}</div>${linksSpan(variantLinks(variant))}</div>`
}

function rangeGuessesHtml(row, omitVariant) {
  return rangeScoredVariants(row).filter(({ variant }) => variant !== omitVariant).map(({ variant }) => `<div class="guess">${openDialogSpan(variant.title, variant.artist)}${escapeHtml(variant.title)}</span>${variant.artist ? ` <span class="small">${escapeHtml(variant.artist)}</span>` : ''} ${jumpLink(variant.start, 'guess-time')}–${jumpLink(variant.end, 'guess-time')}${linksSpan(variantLinks(variant))}<div class="small">${variantEvidence(variant)}</div></div>`).join('')
}

function guessCellHtml(row, omitVariant) {
  const guesses = rangeGuessesHtml(row, omitVariant)
  return `<td class="guesses">${guesses}</td>`
}

function rowClasses(row, baseClass) {
  const classes = [baseClass]
  if (row.track) classes.push('decided')
  if (row.number !== null && row.number !== undefined) classes.push('row-ready')
  if (row.posted) classes.push('row-posted')
  return classes.join(' ')
}

function numberHtml(row) {
  if (row.number === null || row.number === undefined) return ''
  return `<b class="row-number">${String(row.number).padStart(2, '0')}</b> `
}

function trackDisplay(row, guessTitleHtml, guessArtistHtml) {
  if (row.track) {
    if (row.track.isId) {
      const artists = row.track.artists ? row.track.artists.trim() : ''
      return { titleHtml: 'ID', artistHtml: escapeHtml(artists || 'ID') }
    }
    return {
      titleHtml: escapeHtml(row.track.title || 'ID'),
      artistHtml: row.track.artists ? escapeHtml(row.track.artists) : '',
    }
  }
  return { titleHtml: guessTitleHtml, artistHtml: guessArtistHtml || '' }
}

function openDialogSpan(title, artists, start) {
  const attrs = artists !== undefined
    ? ` data-artists="${escapeHtml(artists)}" data-title="${escapeHtml(title)}"`
    : ''
  const startAttr = start ? ` data-start="${escapeHtml(JSON.stringify(start))}"` : ''
  return `<span class="open-dialog"${attrs}${startAttr}>`
}

function ownTitleSpan(row, title, artists) {
  if (row.track) {
    const startAttr = row.start ? ` data-start="${escapeHtml(JSON.stringify(row.start))}"` : ''
    return `<span class="open-dialog" data-track="${escapeHtml(JSON.stringify(row.track))}" data-note="${escapeHtml(row.note || '')}"${startAttr}>`
  }
  return openDialogSpan(title, artists, row.start)
}

function rowActionsHtml(row) {
  const postHtml = row.postReady ? ' <a href="#" class="post-1001">post to 1001</a>' : ''
  const rowNumberLabel = row.number === null || row.number === undefined ? '?' : String(row.number).padStart(2, '0')
  const postedHtml = row.posted
    ? ` <span class="small">posted ${escapeHtml(row.posted.suggestionId)}</span> <a href="#" class="forget-post" data-number="${rowNumberLabel}">forget post</a>`
    : ''
  return '<span class="row-actions">'
    + '<a href="#" class="action-merge-up">merge with above</a> '
    + '<a href="#" class="action-merge-down">merge with below</a> '
    + '<a href="#" class="action-insert-above">add empty above</a> '
    + '<a href="#" class="action-insert-below">add empty below</a> '
    + '<a href="#" class="action-delete">delete row</a>'
    + postHtml + postedHtml
    + '</span>'
}

function buildEmptyRow(row, index) {
  const decided = row.start !== null
  const jumpHtml = decided
    ? jumpLink(row.start.seconds, 'big decided')
    : index === 0 ? jumpLink(0, 'big') : '<span class="jump-link big">—</span>'
  const smallLine = decided ? decidedSmallLine(index) : ''
  const bestGuess = row.track ? null : rangeScoredVariants(row)[0]?.variant
  const winner = row.track ? matchingSuggestion(row) : null
  const { titleHtml, artistHtml } = trackDisplay(row, bestGuess ? escapeHtml(bestGuess.title) : 'ID', bestGuess ? escapeHtml(bestGuess.artist) : '')
  const guessLinksHtml = bestGuess ? linksSpan(variantLinks(bestGuess)) : ''
  const guessEvidenceHtml = bestGuess ? `<div class="small">${jumpLink(bestGuess.start, 'guess-time')}–${jumpLink(bestGuess.end, 'guess-time')} ${variantEvidence(bestGuess)}</div>` : ''
  return `<tr class="${rowClasses(row, 'row-gap')}" data-row-id="${row.id}">
<td class="jump">${numberHtml(row)}${jumpHtml}${GRAB_LINK_HTML}${smallLine}</td>
<td>${decidedMark(row)}<b>${ownTitleSpan(row, bestGuess?.title, bestGuess?.artist)}${titleHtml}</span></b>${confirmedLinkHtml(row)}${guessLinksHtml}${artistHtml ? `<div class="small">${artistHtml}</div>` : ''}${guessEvidenceHtml}
${rowActionsHtml(row)}${winningSuggestionHtml(winner)}</td>${guessCellHtml(row, winner || (!row.track ? bestGuess : null))}</tr>`
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
    ? decidedSmallLine(index)
    : `<div class="small">${jumpLink(earliest, 'earliest')} — ${jumpLink(latest, 'latest')}</div>`
  const span = Math.round(latest - earliest)
  const minutes = Math.floor(span / 60)
  const secs = span % 60
  const bestGuess = row.track ? null : rangeScoredVariants(row)[0]?.variant
  const winner = row.track ? matchingSuggestion(row) : null
  const { titleHtml, artistHtml } = trackDisplay(row, bestGuess ? escapeHtml(bestGuess.title) : 'ID', bestGuess ? escapeHtml(bestGuess.artist) : '')
  const guessLinksHtml = bestGuess ? linksSpan(variantLinks(bestGuess)) : ''
  const guessEvidenceHtml = bestGuess ? `<div class="small">${jumpLink(bestGuess.start, 'guess-time')}–${jumpLink(bestGuess.end, 'guess-time')} ${variantEvidence(bestGuess)}</div>` : ''
  return `<tr class="${rowClasses(row, 'row-gap')}" data-row-id="${row.id}">
<td class="jump">${numberHtml(row)}${jumpLink(bigSeconds, bigCss)}${GRAB_LINK_HTML}
${smallLine}</td>
<td>${decidedMark(row)}<b>${ownTitleSpan(row, bestGuess?.title, bestGuess?.artist)}${titleHtml}</span></b>${confirmedLinkHtml(row)}${guessLinksHtml}${artistHtml ? `<div class="small">${artistHtml}</div>` : ''}${guessEvidenceHtml}${row.track ? '' : `<div class="small">${minutes} min ${secs} s with no match</div>`}
${rowActionsHtml(row)}${winningSuggestionHtml(winner)}</td>${guessCellHtml(row, winner || (!row.track ? bestGuess : null))}</tr>`
}

function buildTrackRow(row, index, lowConfidence) {
  const sources = row.merged.filter((m) => m.kind === 'track')
  const scored = sources
    .flatMap((m) => m.variants.map((v) => ({ v, m, score: variantScore(v) })))
    .sort((a, b) => b.score - a.score)
  const primary = scored[0].v
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
    ? decidedSmallLine(index)
    : `<div class="small">${jumpLink(earliest, 'earliest')} ${jumpLink(best, 'best')} ${jumpLink(latest, 'latest')}</div>`

  const bestGuess = row.track ? primary : rangeScoredVariants(row)[0]?.variant || primary
  const { titleHtml, artistHtml } = trackDisplay(row, escapeHtml(bestGuess.title), escapeHtml(bestGuess.artist))
  const titleLinksHtml = row.track ? '' : linksSpan(variantLinks(bestGuess))
  const evidenceHtml = row.track ? '' : `<div class="small">${jumpLink(bestGuess.start, 'guess-time')}–${jumpLink(bestGuess.end, 'guess-time')} ${variantEvidence(bestGuess)}</div>`
  const winner = row.track ? matchingSuggestion(row) : null

  return `<tr class="${rowClasses(row, cls)}" data-row-id="${row.id}">
<td class="jump">${numberHtml(row)}${jumpLink(bigSeconds, bigCss)}${GRAB_LINK_HTML}
${smallLine}</td>
<td>${decidedMark(row)}<b>${ownTitleSpan(row, bestGuess.title, bestGuess.artist)}${titleHtml}</span></b>${confirmedLinkHtml(row)}${titleLinksHtml}${artistHtml ? `<div class="small">${artistHtml}</div>` : ''}${evidenceHtml}${rowActionsHtml(row)}${winningSuggestionHtml(winner)}</td>${guessCellHtml(row, winner || (!row.track ? bestGuess : null))}</tr>`
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
    if (audioPlayer && !audioPlayer.paused) savePosition(audioPlayer.currentTime)
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
    videoId: sourceYoutubeId,
    width: 640,
    height: 360,
    events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange },
  })
}

function initializePlayer(youtubeId) {
  if (playerInitialized) return
  playerInitialized = true
  sourceYoutubeId = youtubeId
  if (youtubeId) {
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.append(script)
  } else {
    audioPlayer = document.getElementById('audio')
    audioPlayer.hidden = false
    audioPlayer.src = `/api/sets/${encodeURIComponent(VIDEO_ID)}/audio`
    audioPlayer.addEventListener('loadedmetadata', () => {
      const saved = loadSavedPosition()
      if (saved !== null) audioPlayer.currentTime = saved
    })
    audioPlayer.addEventListener('error', () => showMessage('Could not load local audio. Check the download, then reload the page.'))
    audioPlayer.addEventListener('play', startPositionTimer)
    audioPlayer.addEventListener('pause', () => {
      stopPositionTimer()
      savePosition(audioPlayer.currentTime)
    })
  }
}

function apiUrl(rowId, suffix) {
  return `/api/sets/${encodeURIComponent(VIDEO_ID)}/rows/${encodeURIComponent(rowId)}${suffix || ''}`
}

function loadAndRender() {
  $.getJSON(`/api/sets/${encodeURIComponent(VIDEO_ID)}`)
    .done((data) => {
      hoveredRow = null
      initializePlayer(data.youtubeId)
      rowsById = new Map(data.rows.map((row) => [row.id, row]))
      const $tbody = $('#tracklist tbody')
      $tbody.empty()
      data.rows.forEach((row, index) => $tbody.append(buildRowHtml(row, index, data.params.lowConfidence)))
    })
    .fail((jqXHR) => {
      showMessage(withStatus('Could not load this set. Check the server, then reload the page.', jqXHR))
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

$(document).on('keydown', (e) => {
  if (e.code !== 'Space' && e.key !== ' ') return
  const dialogEl = document.getElementById('track-dialog')
  const targetTag = e.target && e.target.tagName
  if (dialogEl.open) return
  if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return
  if (e.target && e.target.isContentEditable) return
  e.preventDefault()
  if (audioPlayer) {
    if (audioPlayer.paused) audioPlayer.play()
    else audioPlayer.pause()
    return
  }
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

$(document).on('click', 'a.jump-link', function (e) {
  e.preventDefault()
  const $el = $(this)
  const seconds = Number($el.data('t'))
  if (audioPlayer) {
    const wasPaused = audioPlayer.paused
    audioPlayer.currentTime = seconds
    if (wasPaused) audioPlayer.play()
    savePosition(seconds)
    return
  }
  if (!player || typeof player.seekTo !== 'function') return
  const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : YT.PlayerState.UNSTARTED
  player.seekTo(seconds, true)
  if (state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.CUED) {
    player.playVideo()
  }
  savePosition(seconds)
})

$(document).on('click', 'button[data-seek]', function () {
  const delta = Number($(this).data('seek'))
  if (audioPlayer) {
    audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime + delta)
    savePosition(audioPlayer.currentTime)
    return
  }
  if (!player || typeof player.getCurrentTime !== 'function') return
  const seconds = Math.max(0, player.getCurrentTime() + delta)
  player.seekTo(seconds, true)
  savePosition(seconds)
})

$(document).on('click', 'a.undo-link', function (e) {
  e.preventDefault()
  clearStart(rowIdOf($(this)))
})

$(document).on('click', 'a.grab-link', function (e) {
  e.preventDefault()
  if (audioPlayer) {
    if (!audioPlayer.paused) {
      showMessage('Pause the player, then grab its time.')
      return
    }
    saveStart(rowIdOf($(this)), audioPlayer.currentTime, 'grab')
    return
  }
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

function parseCue(text) {
  const parts = text.split(':').map((p) => p.trim())
  if (parts.some((p) => p === '' || !/^\d+$/.test(p))) return null
  const nums = parts.map(Number)
  if (nums.length === 1) return nums[0]
  if (nums.length === 2) return nums[0] * 60 + nums[1]
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2]
  return null
}

function linkKindFromUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.host) return null
  const host = parsed.host
  if (host === 'open.spotify.com') return 'spotify'
  if (host === 'music.youtube.com' || host === 'youtube.com' || host === 'www.youtube.com' || host === 'youtu.be') return 'youtubeMusic'
  if (host === 'music.apple.com') return 'apple'
  return 'other'
}

let previewRequest = null
$(document).on('input', '#track-dialog [name=link]', function () {
  const $preview = $('#track-dialog .link-preview').text('')
  if (previewRequest) previewRequest.abort()
  const url = $(this).val().trim()
  if (!/^https?:\/\/\S+$/i.test(url)) return
  previewRequest = $.getJSON('/api/link-preview', { url }).done((data) => {
    if (data && data.title) $preview.text(data.artist ? `${data.title} — ${data.artist}` : data.title)
  })
})

function openDialog(rowId, fields) {
  const dialogEl = document.getElementById('track-dialog')
  dialogEl.returnValue = ''
  dialogEl.dataset.rowId = rowId
  const $dialog = $(dialogEl)
  $dialog.find('[name=cue]').val(fields.start ? hms(fields.start.seconds) : '')
  $dialog.find('[name=link]').val((fields.links && fields.links[0] && fields.links[0].url) || '')
  $dialog.find('.link-preview').text('')
  $dialog.find('[name=artists]').val(fields.artists || '')
  $dialog.find('[name=title]').val(fields.title || '')
  $dialog.find('[name=version]').val(fields.version || '')
  $dialog.find('[name=label]').val(fields.label || '')
  $dialog.find('[name=isId]').prop('checked', !!fields.isId)
  $dialog.find('[name=isIdVersion]').prop('checked', !!fields.isIdVersion)
  $dialog.find('[name=stackedWithPrevious]').prop('checked', !!fields.stackedWithPrevious)
  $dialog.find('[name=note]').val(fields.note || '')
  const row = rowsById.get(rowId)
  const entries = row ? row.rangeEntries : []
  const guesses = entries.flatMap((entry) => entry.kind === 'track'
    ? entry.variants.map((variant) => `<li><button type="button" class="dialog-guess" data-title="${escapeHtml(variant.title)}" data-artists="${escapeHtml(variant.artist)}">${escapeHtml(variant.title)}</button><span class="small">${escapeHtml(variant.artist)} · ${variantEvidence({ tracklistify: variant.tracklistify, ripthatset: variant.ripthatset })} · ${hms(variant.start)}–${hms(variant.end)}</span>${linksSpan(variantLinks(variant))}</li>`)
    : [`<li><span>Gap</span><span class="small">${hms(entry.earliest)}–${hms(entry.latest)}</span></li>`])
  $dialog.find('#dialog-guesses').html(guesses.length ? `<h3>Detections in this row range</h3><ul>${guesses.join('')}</ul>` : '')
  dialogEl.showModal()
}

$(document).on('click', '.dialog-guess', function () {
  const $guess = $(this)
  const $dialog = $('#track-dialog')
  $dialog.find('[name=artists]').val($guess.attr('data-artists') || '')
  $dialog.find('[name=title]').val($guess.attr('data-title') || '')
})

$(document).on('click', '.open-dialog', function () {
  const $el = $(this)
  const rowId = rowIdOf($el)
  const track = $el.data('track')
  const start = $el.data('start') || null
  if (track) {
    openDialog(rowId, { ...track, note: $el.data('note'), start })
  } else {
    openDialog(rowId, { artists: $el.data('artists'), title: $el.data('title'), start })
  }
})

document.getElementById('track-cancel').addEventListener('click', () => {
  document.getElementById('track-dialog').close('cancel')
})

document.getElementById('track-dialog').addEventListener('close', function () {
  if (this.returnValue !== 'save') return
  const rowId = this.dataset.rowId
  const $dialog = $(this)
  const dialogEl = this

  const cueText = $dialog.find('[name=cue]').val().trim()
  let start
  if (cueText) {
    const seconds = parseCue(cueText)
    if (seconds === null) {
      showMessage('The cue must be h:mm:ss, mm:ss, or a number of seconds.')
      dialogEl.showModal()
      return
    }
    start = { seconds, from: 'typed' }
  }

  const linkText = $dialog.find('[name=link]').val().trim()
  let links
  if (linkText) {
    const kind = linkKindFromUrl(linkText)
    if (!kind) {
      showMessage('The link must be a web address that starts with http:// or https://')
      dialogEl.showModal()
      return
    }
    links = [{ kind, url: linkText }]
  } else {
    links = []
  }

  const track = {
    artists: $dialog.find('[name=artists]').val().trim(),
    title: $dialog.find('[name=title]').val().trim(),
    version: $dialog.find('[name=version]').val().trim(),
    label: $dialog.find('[name=label]').val().trim(),
    isId: $dialog.find('[name=isId]').prop('checked'),
    isIdVersion: $dialog.find('[name=isIdVersion]').prop('checked'),
    stackedWithPrevious: $dialog.find('[name=stackedWithPrevious]').prop('checked'),
    links,
  }
  const note = $dialog.find('[name=note]').val().trim()
  const patch = { track, note }
  if (start) patch.start = start
  $.ajax({
    url: apiUrl(rowId),
    method: 'PATCH',
    contentType: 'application/json',
    data: JSON.stringify(patch),
  }).done(loadAndRender).fail((jqXHR) => showMessage(withStatus('Could not save the track. Check the server, then reload the page.', jqXHR)))
})

$(document).on('click', 'a.post-1001', function (e) {
  e.preventDefault()
  const $el = $(this)
  if ($el.data('posting')) return
  $el.data('posting', true)
  $el.text('posting…')
  const rowId = rowIdOf($el)
  $.ajax({ url: apiUrl(rowId, '/post-1001'), method: 'POST' })
    .done((data) => {
      const posted = data.rows.find((row) => row.id === rowId)?.posted
      if (posted) showMessage(`Posted row ${posted.trackNo}, suggestion ${posted.suggestionId}`)
      loadAndRender()
    })
    .fail((jqXHR) => {
      const message = (jqXHR.responseJSON && jqXHR.responseJSON.error) || 'Could not post that row.'
      showMessage(withStatus(message, jqXHR))
      loadAndRender()
    })
})

$(document).on('click', 'a.forget-post', function (e) {
  e.preventDefault()
  const $el = $(this)
  const rowId = rowIdOf($el)
  const number = $el.data('number')
  if (!confirm(`Forget the post of row ${number}? The suggestion on 1001Tracklists stays. Post again only when it is gone from the site.`)) return
  $.ajax({ url: apiUrl(rowId, '/post-1001'), method: 'DELETE' })
    .done(() => {
      loadAndRender()
      showMessage(`Row ${number}: post forgotten. Check the site before you post again.`)
    })
    .fail((jqXHR) => {
      const message = (jqXHR.responseJSON && jqXHR.responseJSON.error) || 'Could not forget that post.'
      showMessage(withStatus(message, jqXHR))
    })
})

loadAndRender()
