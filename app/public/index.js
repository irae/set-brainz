function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

function rowHtml(entry) {
  const href = `/sets/${encodeURIComponent(entry.videoId)}`
  const note = entry.hasNewerMerge ? ' <span class="note">newer merged file available</span>' : ''
  return `<tr>
<td><a href="${href}">${escapeHtml(entry.videoId)}</a></td>
<td>${entry.decidedCount} / ${entry.rowCount} decided</td>
<td>${note}</td>
</tr>`
}

$.getJSON('/api/sets')
  .done((data) => {
    const $withDecisions = $('#with-decisions tbody')
    const $mergedOnly = $('#merged-only tbody')
    data.withDecisions.forEach((entry) => $withDecisions.append(rowHtml(entry)))
    data.mergedOnly.forEach((entry) => $mergedOnly.append(rowHtml(entry)))
  })
  .fail(() => {
    $('h1').after(`<p class="note">Could not load the set list. Check the server, then reload the page.</p>`)
  })
