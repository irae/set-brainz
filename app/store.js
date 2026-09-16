import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const cache = new Map()

function dataDir() {
  return process.env.SETBRAINZ_DATA_DIR || 'data'
}

function mergedDirFor(videoId) {
  return join(dataDir(), 'merged', videoId)
}

function decisionsPath(videoId) {
  return join(dataDir(), 'decisions', `${videoId}.json`)
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

export function listSets() {
  const withDecisions = []
  const mergedOnly = []
  const root = join(dataDir(), 'merged')
  const videoIds = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : []
  for (const videoId of videoIds) {
    const doc = peekDecisions(videoId)
    if (doc) {
      withDecisions.push({
        videoId,
        rowCount: doc.rows.length,
        decidedCount: doc.rows.filter(isDecided).length,
        mergedFile: doc.mergedFile,
        hasNewerMerge: newestMergedFilename(videoId) !== doc.mergedFile,
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
    throw new Error(`no merged results for video id ${videoId}`)
  }
  const merged = readMergedFile(videoId, doc.mergedFile)
  const mergedByUuid = new Map(merged.rows.map((row) => [row.uuid, row]))
  const rows = doc.rows.map((row) => ({
    ...row,
    merged: row.sources.map((uuid) => mergedByUuid.get(uuid)).filter(Boolean),
  }))
  return { videoId, mergedFile: doc.mergedFile, set: doc.set, rows }
}
