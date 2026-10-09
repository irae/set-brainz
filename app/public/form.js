function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

const match = location.pathname.match(/^\/sets\/([^/]+)\/edit$/)
let videoId = match ? decodeURIComponent(match[1]) : null

function showError(xhr) {
  $('#message').text(`Request failed (${xhr.status}): ${xhr.responseJSON?.error || xhr.statusText}`)
}

function showStatus(status) {
  let label = 'Saved'
  if (status.status === 'failed') label = 'Failed'
  else if (status.phase === 'download') label = status.status === 'completed' ? 'Downloaded' : 'Downloading'
  else if (status.phase === 'process') {
    label = status.status === 'completed' ? 'Ready to edit' : 'Processing'
  }
  $('#status').text([label, status.step, status.startedAt].filter(Boolean).join(' · '))
  $('#error').text(status?.error || '')
  const busy = status.status === 'queued' || status.status === 'running'
  const processingComplete = status.phase === 'process' && status.status === 'completed'
  $('#download').prop('hidden', status.audioReady || processingComplete).prop('disabled', busy)
  $('#process').prop('hidden', !status.audioReady || processingComplete)
    .prop('disabled', busy)
  $('#decisions-link').html(status.phase === 'process' && status.status === 'completed'
    ? `<a href="/sets/${encodeURIComponent(videoId)}">Open decisions</a>`
    : '')
}

function refreshStatus() {
  $.getJSON(`/api/sets/${encodeURIComponent(videoId)}/process`)
    .done(showStatus)
    .fail(showError)
}

function applySource(source) {
  $('#source-form [name=sourceUrl]').val(source.sourceUrl).prop('readOnly', !!source.sourceLocked)
  $('#source-lock').prop('hidden', !source.sourceLocked)
  $('#source-form [name=title]').val(source.title || '')
  $('#source-form [name=tracklistUrl]').val(source.tracklistUrl || '')
  const sourceLabel = source.youtubeUrl ? 'YouTube' : 'Source'
  const sourceLink = `<a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noopener">${sourceLabel}</a>`
  const tracklistLink = source.tracklistUrl
    ? ` · <a href="${escapeHtml(source.tracklistUrl)}" target="_blank" rel="noopener">1001Tracklists</a>`
    : ''
  $('#source-links').html(`${sourceLink}${tracklistLink}`)
}

if (videoId) {
  $('#page-title').text('Edit set source')
  $('#processing').prop('hidden', false)
  $.getJSON(`/api/sets/${encodeURIComponent(videoId)}/metadata`)
    .done((source) => {
      applySource(source)
      refreshStatus()
    })
    .fail(showError)
}

$('#source-form').on('submit', function (event) {
  event.preventDefault()
  const data = Object.fromEntries(new FormData(this))
  const method = videoId ? 'PATCH' : 'POST'
  const url = videoId ? `/api/sets/${encodeURIComponent(videoId)}/metadata` : '/api/sets'
  if (!videoId) {
    data.url = data.sourceUrl
    delete data.sourceUrl
  }
  $.ajax({ url, method, contentType: 'application/json', data: JSON.stringify(data) })
    .done((source) => {
      videoId = source.videoId
      location.assign(`/sets/${encodeURIComponent(videoId)}/edit`)
    })
    .fail(showError)
})

$('#download').on('click', () => {
  $.ajax({ url: `/api/sets/${encodeURIComponent(videoId)}/download`, method: 'POST' })
    .done(showStatus)
    .fail(showError)
})

$('#process').on('click', () => {
  $.ajax({ url: `/api/sets/${encodeURIComponent(videoId)}/process`, method: 'POST' })
    .done(showStatus)
    .fail(showError)
})
