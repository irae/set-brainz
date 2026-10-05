import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getProcessingStatus } from './processing.js'

const cache = new Map()

const VALID_START_FROM = ['earliest', 'best', 'latest', 'grab', 'was-big', 'big', 'typed']

function storeError(code, message) {
  return Object.assign(new Error(message), { code })
}

function dataDir() {
  return process.env.SETBRAINZ_DATA_DIR || 'data'
}

function mergedDirFor(videoId) {
  return join(dataDir(), 'merged', videoId)
}

function decisionsPath(videoId) {
  return join(dataDir(), 'decisions', `${videoId}.json`)
}

function decisionsPrevPath(videoId) {
  return join(dataDir(), 'decisions', `${videoId}.prev.json`)
}

function isSourceLocked(videoId) {
  const status = getProcessingStatus(videoId)
  const audioDir = join(dataDir(), 'audio', videoId)
  const hasAudio = existsSync(audioDir) && readdirSync(audioDir).some((name) => name.endsWith('.mp3'))
  return status.status === 'queued' || status.status === 'running' || hasAudio
    || existsSync(decisionsPath(videoId)) || listMergedFilenames(videoId).length > 0
}

function sourceSetsPath() {
  return join(dataDir(), 'sets.json')
}

function readSourceSets() {
  const path = sourceSetsPath()
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
}

function writeSourceSets(sets) {
  mkdirSync(dataDir(), { recursive: true })
  const target = sourceSetsPath()
  const temp = `${target}.${process.pid}-${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(sets, null, 2) + '\n')
  renameSync(temp, target)
}

function validSourceUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.host
  } catch {
    return false
  }
}

function validateVideoId(videoId) {
  if (!/^[A-Za-z0-9_-]+$/.test(videoId)) throw storeError('invalid_video_id', 'invalid set id')
}

function youtubeId(sourceUrl) {
  const url = new URL(sourceUrl)
  if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null
  if (!/(^|\.)youtube(?:-nocookie)?\.com$/.test(url.hostname)) return null
  return url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] || null
}

export function createSourceSet({ url, title = '', tracklistUrl = '' } = {}) {
  if (!validSourceUrl(url)) throw storeError('invalid_source_url', 'url must be an http or https URL')
  if (typeof title !== 'string') throw storeError('invalid_title', 'title must be text')
  if (typeof tracklistUrl !== 'string' || (tracklistUrl && !validSourceUrl(tracklistUrl))) {
    throw storeError('invalid_tracklist_url', 'tracklistUrl must be empty or an http or https URL')
  }
  const sourceVideoId = youtubeId(url)
  if (sourceVideoId && !/^[A-Za-z0-9_-]+$/.test(sourceVideoId)) {
    throw storeError('invalid_video_id', 'the YouTube URL has an invalid video id')
  }
  const id = sourceVideoId || `source-${randomUUID()}`
  const sets = readSourceSets()
  if (Object.values(sets).some((entry) => entry.sourceUrl === url)) {
    throw storeError('source_exists', 'a set already uses this source URL')
  }
  if (sets[id] || listMergedVideoIds().includes(id) || listDecisionVideoIds().includes(id)) {
    throw storeError('source_exists', `a set already exists for ${id}`)
  }
  sets[id] = { sourceUrl: url, title: title.trim(), tracklistUrl }
  writeSourceSets(sets)
  return { videoId: id, ...sets[id], sourceLocked: isSourceLocked(id) }
}

export function getSourceSet(videoId) {
  validateVideoId(videoId)
  const entry = readSourceSets()[videoId]
  if (entry) return {
    videoId,
    ...entry,
    ...(youtubeId(entry.sourceUrl) ? { youtubeUrl: entry.sourceUrl } : {}),
    sourceLocked: isSourceLocked(videoId),
  }
  if (!listMergedVideoIds().includes(videoId) && !listDecisionVideoIds().includes(videoId)) {
    throw storeError('unknown_video', `no source set for video id ${videoId}`)
  }
  const infoPath = join(dataDir(), 'runs', videoId, 'info.txt')
  let title = videoId
  if (existsSync(infoPath)) {
    const fields = readFileSync(infoPath, 'utf8').split('|')
    if (fields.length >= 3) title = fields.slice(0, -2).join('|').trim() || videoId
  }
  return {
    videoId,
    sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    youtubeUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    title,
    tracklistUrl: getTracklistUrl(videoId),
    sourceLocked: isSourceLocked(videoId),
  }
}

export function updateSourceSet(videoId, changes = {}) {
  validateVideoId(videoId)
  const sets = readSourceSets()
  if (!sets[videoId]) {
    const existing = getSourceSet(videoId)
    sets[videoId] = {
      sourceUrl: existing.sourceUrl,
      title: existing.title,
      tracklistUrl: existing.tracklistUrl,
    }
  }
  if (Object.hasOwn(changes, 'sourceUrl')) {
    if (!validSourceUrl(changes.sourceUrl)) throw storeError('invalid_source_url', 'sourceUrl must be an http or https URL')
    if (changes.sourceUrl !== sets[videoId].sourceUrl && isSourceLocked(videoId)) {
      throw storeError('source_locked', 'the source URL is locked after download starts or results exist')
    }
    if (Object.entries(sets).some(([id, entry]) => id !== videoId && entry.sourceUrl === changes.sourceUrl)) {
      throw storeError('source_exists', 'a set already uses this source URL')
    }
    sets[videoId].sourceUrl = changes.sourceUrl
  }
  if (Object.hasOwn(changes, 'title')) {
    if (typeof changes.title !== 'string') throw storeError('invalid_title', 'title must be text')
    sets[videoId].title = changes.title.trim()
  }
  if (Object.hasOwn(changes, 'tracklistUrl')) {
    if (typeof changes.tracklistUrl !== 'string' || (changes.tracklistUrl && !validSourceUrl(changes.tracklistUrl))) {
      throw storeError('invalid_tracklist_url', 'tracklistUrl must be empty or an http or https URL')
    }
    sets[videoId].tracklistUrl = changes.tracklistUrl
  }
  writeSourceSets(sets)
  return { videoId, ...sets[videoId], sourceLocked: isSourceLocked(videoId) }
}

export function getTracklistUrl(videoId) {
  const sourceSets = readSourceSets()
  if (Object.hasOwn(sourceSets, videoId)) return sourceSets[videoId].tracklistUrl || ''
  const path = join(dataDir(), '1001', 'tracklists.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8'))[videoId] || '' : ''
}

function tracklistUrlFor(videoId, sourceSets, tracklists) {
  return Object.hasOwn(sourceSets, videoId) ? sourceSets[videoId].tracklistUrl || '' : tracklists[videoId] || ''
}

function listMergedFilenames(videoId) {
  const dir = mergedDirFor(videoId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
}

function newestMergedFilename(videoId) {
  const files = listMergedFilenames(videoId)
  return files.length ? files[files.length - 1] : null
}

function readMergedFile(videoId, filename) {
  return JSON.parse(readFileSync(join(mergedDirFor(videoId), filename), 'utf8'))
}

function readDecisionsFile(videoId) {
  return JSON.parse(readFileSync(decisionsPath(videoId), 'utf8'))
}

function writeDecisionsFile(videoId, doc) {
  const target = decisionsPath(videoId)
  mkdirSync(join(dataDir(), 'decisions'), { recursive: true })
  const tmpPath = `${target}.${process.pid}-${Date.now()}.tmp`
  writeFileSync(tmpPath, JSON.stringify(doc, null, 2) + '\n')
  renameSync(tmpPath, target)
}

function bootstrapDecisions(videoId) {
  const filename = newestMergedFilename(videoId)
  if (!filename) return null
  const merged = readMergedFile(videoId, filename)
  const now = new Date().toISOString()
  const doc = {
    videoId,
    mergedFile: filename,
    createdAt: now,
    updatedAt: now,
    set: {},
    rows: merged.rows.map((row) => ({
      id: randomUUID(),
      sources: [row.uuid],
      start: null,
      track: null,
      note: '',
      updatedAt: now,
    })),
  }
  writeDecisionsFile(videoId, doc)
  return doc
}

function loadDecisions(videoId) {
  if (cache.has(videoId)) return cache.get(videoId)
  const doc = existsSync(decisionsPath(videoId)) ? readDecisionsFile(videoId) : bootstrapDecisions(videoId)
  if (doc) cache.set(videoId, doc)
  return doc
}

function peekDecisions(videoId) {
  if (cache.has(videoId)) return cache.get(videoId)
  if (!existsSync(decisionsPath(videoId))) return null
  const doc = readDecisionsFile(videoId)
  cache.set(videoId, doc)
  return doc
}

function isDecided(row) {
  return row.start !== null || row.track !== null
}

function findRowIndex(doc, rowId) {
  const index = doc.rows.findIndex((row) => row.id === rowId)
  if (index === -1) throw storeError('unknown_row', `no row ${rowId} for video id ${doc.videoId}`)
  return index
}

function copyToPrevFile(videoId) {
  const target = decisionsPath(videoId)
  writeFileSync(decisionsPrevPath(videoId), readFileSync(target))
}

function applyChange(videoId, mutate) {
  const doc = loadDecisions(videoId)
  if (!doc) {
    throw storeError('unknown_video', `no merged results for video id ${videoId}`)
  }
  const now = new Date().toISOString()
  mutate(doc, now)
  copyToPrevFile(videoId)
  doc.updatedAt = now
  writeDecisionsFile(videoId, doc)
  return doc
}

function listMergedVideoIds() {
  const root = join(dataDir(), 'merged')
  return existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : []
}

function listDecisionVideoIds() {
  const root = join(dataDir(), 'decisions')
  return existsSync(root)
    ? readdirSync(root)
        .filter((name) => name.endsWith('.json') && !name.endsWith('.prev.json'))
        .map((name) => name.slice(0, -'.json'.length))
    : []
}

export function listSets() {
  const withDecisions = []
  const mergedOnly = []
  const tracklistsPath = join(dataDir(), '1001', 'tracklists.json')
  const tracklists = existsSync(tracklistsPath) ? JSON.parse(readFileSync(tracklistsPath, 'utf8')) : {}
  const sourceSets = readSourceSets()
  const videoIds = [...new Set([...listMergedVideoIds(), ...listDecisionVideoIds()])]
  const items = []
  for (const videoId of videoIds) {
    const infoPath = join(dataDir(), 'runs', videoId, 'info.txt')
    let title = videoId
    if (existsSync(infoPath)) {
      const fields = readFileSync(infoPath, 'utf8').split('|')
      if (fields.length >= 3) title = fields.slice(0, -2).join('|').trim() || videoId
    }
    const doc = peekDecisions(videoId)
    if (doc) {
      const newestFilename = newestMergedFilename(videoId)
      const entry = {
        videoId,
        title: sourceSets[videoId]?.title || title,
        sourceUrl: sourceSets[videoId]?.sourceUrl || `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        ...(sourceSets[videoId]
          ? (youtubeId(sourceSets[videoId].sourceUrl) ? { youtubeUrl: sourceSets[videoId].sourceUrl } : {})
          : { youtubeUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` }),
        tracklistUrl: tracklistUrlFor(videoId, sourceSets, tracklists),
        rowCount: doc.rows.length,
        decidedCount: doc.rows.filter(isDecided).length,
        mergedFile: doc.mergedFile,
        hasNewerMerge: newestFilename !== null && newestFilename !== doc.mergedFile,
      }
      withDecisions.push(entry)
      items.push({ ...entry, ...processingStatus(videoId, 'completed') })
      continue
    }
    const filename = newestMergedFilename(videoId)
    if (!filename) continue
    const merged = readMergedFile(videoId, filename)
    const entry = {
      videoId,
      title: sourceSets[videoId]?.title || title,
      sourceUrl: sourceSets[videoId]?.sourceUrl || `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      ...(sourceSets[videoId]
        ? (youtubeId(sourceSets[videoId].sourceUrl) ? { youtubeUrl: sourceSets[videoId].sourceUrl } : {})
        : { youtubeUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` }),
      tracklistUrl: tracklistUrlFor(videoId, sourceSets, tracklists),
      rowCount: merged.rows.length,
      decidedCount: 0,
      mergedFile: filename,
      hasNewerMerge: false,
    }
    mergedOnly.push(entry)
    items.push({ ...entry, ...processingStatus(videoId, 'completed') })
  }
  for (const [videoId, source] of Object.entries(sourceSets)) {
    if (items.some((entry) => entry.videoId === videoId)) continue
    const infoPath = join(dataDir(), 'runs', videoId, 'info.txt')
    let infoTitle = ''
    if (existsSync(infoPath)) {
      const fields = readFileSync(infoPath, 'utf8').split('|')
      if (fields.length >= 3) infoTitle = fields.slice(0, -2).join('|').trim()
    }
    items.push({
      videoId,
      title: source.title || infoTitle || videoId,
      sourceUrl: source.sourceUrl,
      ...(youtubeId(source.sourceUrl) ? { youtubeUrl: source.sourceUrl } : {}),
      tracklistUrl: source.tracklistUrl || '',
      rowCount: 0,
      decidedCount: 0,
      mergedFile: null,
      hasNewerMerge: false,
      ...processingStatus(videoId, 'saved'),
    })
  }
  return { withDecisions, mergedOnly, items }
}

function processingStatus(videoId, fallback) {
  if (fallback === 'completed') return { status: 'completed', phase: 'process', step: null }
  const status = getProcessingStatus(videoId)
  if (status?.status === 'idle') {
    return status.audioExists
      ? { status: 'completed', phase: 'download', step: null, audioExists: true }
      : { status: 'saved', audioExists: false }
  }
  return status || { status: fallback }
}

export function getSet(videoId) {
  const doc = loadDecisions(videoId)
  if (!doc) {
    throw storeError('unknown_video', `no merged results for video id ${videoId}`)
  }
  if (!existsSync(join(mergedDirFor(videoId), doc.mergedFile))) {
    throw storeError('missing_merged_file', `the merged file ${doc.mergedFile} for video id ${videoId} is missing`)
  }
  const merged = readMergedFile(videoId, doc.mergedFile)
  const mergedByUuid = new Map(merged.rows.map((row) => [row.uuid, row]))
  const rows = doc.rows.map((row) => ({
    ...row,
    merged: row.sources.map((uuid) => mergedByUuid.get(uuid)).filter(Boolean),
  }))
  const rowTimes = rows.map((row) => row.start?.seconds
    ?? (row.merged.length ? Math.min(...row.merged.map((entry) => entry.earliest)) : null))
  rows.forEach((row, index) => {
    const lower = rowTimes[index]
    const upper = lower === null ? null : rowTimes.slice(index + 1).find((time) => time !== null && time > lower) ?? merged.durationSeconds
    row.span = lower === null ? null : { start: lower, end: upper }
    row.rangeEntries = merged.rows.flatMap((entry) => {
      if (row.merged.some((source) => source.uuid === entry.uuid)) return [entry]
      if (lower === null || entry.latest < lower || entry.earliest >= upper) return []
      if (entry.kind === 'gap') return [entry]
      const variants = entry.variants.filter((variant) => variant.start >= lower && variant.start < upper)
      return variants.length ? [{ ...entry, variants }] : []
    })
  })
  const numbers = rowNumbers(rows)
  rows.forEach((row, index) => {
    row.number = numbers[index]
    row.postReady = isReadyToPost(row, row.number)
  })
  const source = getSourceSet(videoId)
  return {
    videoId,
    sourceUrl: source.sourceUrl,
    youtubeId: youtubeId(source.sourceUrl),
    mergedFile: doc.mergedFile,
    params: merged.params,
    set: doc.set,
    rows,
  }
}

const TRACK_TEXT_FIELDS = ['artists', 'title', 'version', 'label']
const TRACK_BOOL_FIELDS = ['isId', 'isIdVersion', 'stackedWithPrevious']
const VALID_LINK_KINDS = ['spotify', 'youtubeMusic', 'apple', 'other']

function isValidLinkUrl(url) {
  if (typeof url !== 'string') return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host !== ''
}

function validateStart(start) {
  if (start === null) return
  if (typeof start !== 'object' || Array.isArray(start)) {
    throw storeError('invalid_start', 'start must be null or an object')
  }
  if (!Number.isFinite(start.seconds) || start.seconds < 0) {
    throw storeError('invalid_start_seconds', `start.seconds must be a number that is not less than zero, got ${start.seconds}`)
  }
  if (!VALID_START_FROM.includes(start.from)) {
    throw storeError('invalid_start_from', `unknown start from ${start.from}`)
  }
}

function validateTrack(track) {
  if (track === null) return
  if (typeof track !== 'object' || Array.isArray(track)) {
    throw storeError('invalid_track', 'track must be null or an object')
  }
  for (const field of TRACK_TEXT_FIELDS) {
    if (field in track && typeof track[field] !== 'string') {
      throw storeError('invalid_track', `track.${field} must be text`)
    }
  }
  for (const field of TRACK_BOOL_FIELDS) {
    if (field in track && typeof track[field] !== 'boolean') {
      throw storeError('invalid_track', `track.${field} must be true or false`)
    }
  }
  if ('links' in track) {
    if (!Array.isArray(track.links)) {
      throw storeError('invalid_track', 'track.links must be a list')
    }
    for (const link of track.links) {
      if (typeof link !== 'object' || link === null || Array.isArray(link)) {
        throw storeError('invalid_track', 'each track.links entry must be an object')
      }
      if (!VALID_LINK_KINDS.includes(link.kind)) {
        throw storeError('invalid_track', `unknown link kind ${link.kind}`)
      }
      if (!isValidLinkUrl(link.url)) {
        throw storeError('invalid_track', `link.url must be a web address that starts with http:// or https://, got ${link.url}`)
      }
    }
  }
}

function validateNote(note) {
  if (typeof note !== 'string') {
    throw storeError('invalid_note', 'note must be text')
  }
}

export function updateRow(videoId, rowId, patch) {
  if ('posted' in patch) {
    throw storeError('posted_is_read_only', 'a patch may not set posted')
  }
  if ('postHistory' in patch) {
    throw storeError('postHistory_is_read_only', 'a patch may not set postHistory')
  }
  if ('start' in patch) validateStart(patch.start)
  if ('track' in patch) validateTrack(patch.track)
  if ('note' in patch) validateNote(patch.note)
  return applyChange(videoId, (doc, now) => {
    const row = doc.rows[findRowIndex(doc, rowId)]
    if ('start' in patch) row.start = patch.start
    if ('track' in patch) row.track = patch.track
    if ('note' in patch) row.note = patch.note
    row.updatedAt = now
  })
}

function keepEarlierDecision(target, source) {
  if (target.start === null) target.start = source.start
  if (target.track === null) target.track = source.track
  if (!target.note) target.note = source.note
}

export function mergeRow(videoId, rowId, direction) {
  return applyChange(videoId, (doc, now) => {
    const index = findRowIndex(doc, rowId)
    if (direction === 'up') {
      if (index === 0) throw storeError('merge_at_boundary', 'cannot merge the first row up')
      const target = doc.rows[index - 1]
      const source = doc.rows[index]
      target.sources = [...target.sources, ...source.sources]
      keepEarlierDecision(target, source)
      target.updatedAt = now
      doc.rows.splice(index, 1)
    } else if (direction === 'down') {
      if (index === doc.rows.length - 1) throw storeError('merge_at_boundary', 'cannot merge the last row down')
      const target = doc.rows[index]
      const source = doc.rows[index + 1]
      target.sources = [...target.sources, ...source.sources]
      keepEarlierDecision(target, source)
      target.updatedAt = now
      doc.rows.splice(index + 1, 1)
    } else {
      throw storeError('invalid_direction', `unknown merge direction ${direction}`)
    }
  })
}

export function insertEmptyRow(videoId, rowId, position) {
  return applyChange(videoId, (doc, now) => {
    const index = findRowIndex(doc, rowId)
    if (position !== 'above' && position !== 'below') {
      throw storeError('invalid_position', `unknown insert position ${position}`)
    }
    const newRow = { id: randomUUID(), sources: [], start: null, track: null, note: '', updatedAt: now }
    const insertAt = position === 'above' ? index : index + 1
    doc.rows.splice(insertAt, 0, newRow)
  })
}

export function deleteRow(videoId, rowId) {
  return applyChange(videoId, (doc) => {
    doc.rows.splice(findRowIndex(doc, rowId), 1)
  })
}

export function markPosted(videoId, rowId, posted) {
  return applyChange(videoId, (doc, now) => {
    const row = doc.rows[findRowIndex(doc, rowId)]
    if (row.posted) {
      throw storeError('already_posted', `row ${rowId} for video id ${videoId} is already posted`)
    }
    row.posted = posted
    row.updatedAt = now
  })
}

export function clearPosted(videoId, rowId) {
  return applyChange(videoId, (doc, now) => {
    const row = doc.rows[findRowIndex(doc, rowId)]
    if (!row.posted) {
      throw storeError('not_posted', `row ${rowId} for video id ${videoId} is not posted`)
    }
    row.postHistory = [...(row.postHistory || []), { ...row.posted, clearedAt: now }]
    row.posted = null
    row.updatedAt = now
  })
}

function isCompleteRow(row) {
  if (row.start === null || row.track === null) return false
  if (row.track.isId) return true
  return !!(row.track.artists?.trim() && row.track.title?.trim())
}

export function rowNumbers(rows) {
  const numbers = []
  let count = 0
  let stopped = false
  for (const row of rows) {
    if (!stopped && isCompleteRow(row)) {
      count += 1
      numbers.push(count)
    } else {
      stopped = true
      numbers.push(null)
    }
  }
  return numbers
}

export function needsNoLink(track) {
  if (track.isId || track.isIdVersion) return true
  return [track.artists, track.title, track.version].some(
    (value) => typeof value === 'string' && /\bID\b/.test(value)
  )
}

function hasPostFields(row, number) {
  if (number === null || number === undefined) return false
  if (needsNoLink(row.track)) return true
  return !!(row.track.links && row.track.links.length > 0)
}

export function isReadyToPost(row, number) {
  return !row.posted && hasPostFields(row, number)
}

export function exportableRows(rows) {
  return rows.filter((row) => hasPostFields(row, row.number))
}
