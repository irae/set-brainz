import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const cache = new Map()

const VALID_START_FROM = ['earliest', 'best', 'latest', 'grab', 'was-big', 'big']

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
  const videoIds = [...new Set([...listMergedVideoIds(), ...listDecisionVideoIds()])]
  for (const videoId of videoIds) {
    const doc = peekDecisions(videoId)
    if (doc) {
      const newestFilename = newestMergedFilename(videoId)
      withDecisions.push({
        videoId,
        rowCount: doc.rows.length,
        decidedCount: doc.rows.filter(isDecided).length,
        mergedFile: doc.mergedFile,
        hasNewerMerge: newestFilename !== null && newestFilename !== doc.mergedFile,
      })
      continue
    }
    const filename = newestMergedFilename(videoId)
    if (!filename) continue
    const merged = readMergedFile(videoId, filename)
    mergedOnly.push({
      videoId,
      rowCount: merged.rows.length,
      decidedCount: 0,
      mergedFile: filename,
      hasNewerMerge: false,
    })
  }
  return { withDecisions, mergedOnly }
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
  return { videoId, mergedFile: doc.mergedFile, params: merged.params, set: doc.set, rows }
}

const TRACK_TEXT_FIELDS = ['artists', 'title', 'version', 'label']
const TRACK_BOOL_FIELDS = ['isId', 'isIdVersion', 'stackedWithPrevious']

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
}

function validateNote(note) {
  if (typeof note !== 'string') {
    throw storeError('invalid_note', 'note must be text')
  }
}

export function updateRow(videoId, rowId, patch) {
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
