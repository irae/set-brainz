function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

function statusText(entry) {
  if (entry.mergedFile) return 'Ready to edit'
  if (entry.status === 'failed') return 'Failed'
  if (entry.phase === 'download') return entry.status === 'completed' ? 'Downloaded' : 'Downloading'
  if (entry.phase === 'process') {
    return entry.status === 'completed'
      ? 'Processing complete'
      : `Processing${entry.step ? ` · ${entry.step}` : ''}`
  }
  return entry.status === 'saved' || entry.status === 'idle' ? 'Saved' : entry.status
}

function rowHtml(entry) {
  const edit = `/sets/${encodeURIComponent(entry.videoId)}/edit`
  const href = entry.mergedFile ? `/sets/${encodeURIComponent(entry.videoId)}` : edit
  const note = entry.hasNewerMerge ? ' <span class="note">newer merged file available</span>' : ''
  const tracklist = entry.tracklistUrl
    ? `<a href="${escapeHtml(entry.tracklistUrl)}" target="_blank" rel="noopener">1001Tracklists</a>`
    : ''
  const source = `<a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener">${entry.youtubeUrl ? 'YouTube' : 'Source'}</a>`
  const csv = entry.mergedFile ? `<a href="/api/sets/${encodeURIComponent(entry.videoId)}/export.csv">CSV</a>` : ''
  const text = entry.mergedFile ? `<a href="#" class="tracklist-text" data-video-id="${escapeHtml(entry.videoId)}">Text</a>` : ''
  return `<tr>
<td><a href="${href}">${escapeHtml(entry.title)}</a><div class="small">${escapeHtml(entry.videoId)}</div></td>
<td>${escapeHtml(statusText(entry))}</td>
<td>${entry.decidedCount} / ${entry.rowCount} decided</td>
<td>${[tracklist, source, csv, text, `<a href="${edit}">Edit</a>`].filter(Boolean).join(' · ')}${note}</td>
</tr>`
}

$.getJSON('/api/sets')
  .done((data) => {
    const $rows = $('tbody')
    ;(data.items || [...data.withDecisions, ...data.mergedOnly]).forEach((entry) => $rows.append(rowHtml(entry)))
  })
  .fail((xhr) => {
    $('h1').after(`<p class="note">Could not load the set list (${xhr.status}). Check the server, then reload the page.</p>`)
  })

$(document).on('click', 'a.tracklist-text', function (event) {
  event.preventDefault()
  const dialogEl = document.getElementById('text-dialog')
  const $area = $('#text-dialog textarea').val('')
  $('#text-dialog .copy-status').text('')
  $.get({ url: `/api/sets/${encodeURIComponent($(this).data('videoId'))}/tracklist.txt`, dataType: 'text' })
    .done((text) => {
      $area.val(text)
      dialogEl.showModal()
    })
    .fail((xhr) => {
      $('h1').after(`<p class="note">Could not load the tracklist text (${xhr.status}). Check the server, then try again.</p>`)
    })
})

$('#text-dialog .copy').on('click', () => {
  navigator.clipboard.writeText($('#text-dialog textarea').val())
    .then(() => $('#text-dialog .copy-status').text('Copied'))
    .catch((error) => $('#text-dialog .copy-status').text(`Copy failed: ${error.message}`))
})

$('#text-dialog .close').on('click', () => document.getElementById('text-dialog').close())
