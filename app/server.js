import express from 'express'
import { existsSync, readdirSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listSets, getSet, updateRow, mergeRow, insertEmptyRow, deleteRow, markPosted, clearPosted, isReadyToPost, exportableRows, createSourceSet, getSourceSet, getTracklistUrl, updateSourceSet } from './store.js'
import { postRow as realPostRow } from './1001-post.js'
import { fetchPreview as realFetchPreview } from './link-preview.js'

const require = createRequire(import.meta.url)
const defaultPublicDir = join(dirname(fileURLToPath(import.meta.url)), 'public')
const jqueryPath = require.resolve('jquery/dist/jquery.js')
const execFileAsync = promisify(execFile)

function publicDir() {
  return process.env.SETBRAINZ_PUBLIC_DIR || defaultPublicDir
}

function dataDir() {
  return process.env.SETBRAINZ_DATA_DIR || 'data'
}

async function lookupTitle(url) {
  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    throw Object.assign(new Error('url must be an http or https URL'), { code: 'invalid_source_url' })
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw Object.assign(new Error('url must be an http or https URL'), { code: 'invalid_source_url' })
  }
  try {
    const result = await execFileAsync('yt-dlp', ['--no-playlist', '--skip-download', '--print', '%(title)s', url], {
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    })
    const title = result.stdout.trim().split('\n')[0]
    if (!title) throw new Error('yt-dlp returned an empty title')
    return title
  } catch (error) {
    throw Object.assign(new Error(`could not read a title from the source URL: ${error.message}`), {
      code: 'metadata_lookup_failed',
    })
  }
}

function hasDownloadedAudio(videoId) {
  const audioDir = join(dataDir(), 'audio', videoId)
  return existsSync(audioDir) && readdirSync(audioDir).some((name) => name.endsWith('.mp3'))
}

function hasMergedResults(videoId) {
  const mergedDir = join(dataDir(), 'merged', videoId)
  return existsSync(join(dataDir(), 'decisions', `${videoId}.json`))
    || (existsSync(mergedDir) && readdirSync(mergedDir).some((name) => name.endsWith('.json')))
}

const STATUS_BY_CODE = {
  unknown_video: 404,
  unknown_row: 404,
  missing_merged_file: 404,
  invalid_direction: 400,
  invalid_position: 400,
  invalid_start: 400,
  invalid_start_from: 400,
  invalid_start_seconds: 400,
  invalid_track: 400,
  invalid_note: 400,
  merge_at_boundary: 400,
  not_ready: 400,
  missing_link: 400,
  no_tracklist_url: 400,
  posted_is_read_only: 400,
  postHistory_is_read_only: 400,
  not_posted: 400,
  already_posted: 409,
  post_in_progress: 409,
  already_suggested: 409,
  row_taken: 409,
  track_mismatch: 409,
  not_logged_in: 502,
  challenge_page: 502,
  no_site_rows: 502,
  site_rejected: 502,
  bad_response: 502,
  invalid_source_url: 400,
  invalid_tracklist_url: 400,
  invalid_title: 400,
  source_exists: 409,
  source_locked: 409,
  invalid_video_id: 400,
  missing_audio: 409,
  existing_results: 409,
  processing_in_progress: 409,
  audio_exists: 409,
  metadata_lookup_failed: 502,
}

const postsInFlight = new Set()

export function createApp({ postRow = realPostRow, fetchPreview = realFetchPreview } = {}) {
  const app = express()
  const dir = publicDir()

  function sendShell(res, filename) {
    res.sendFile(join(dir, filename), (err) => {
      if (err && !res.headersSent) res.status(404).end()
    })
  }

  app.use(express.json())

  app.get('/', (req, res) => sendShell(res, 'index.html'))
  app.get('/sets/new', (req, res) => sendShell(res, 'form.html'))
  app.get('/sets/:videoId/edit', (req, res) => sendShell(res, 'form.html'))
  app.get('/sets/:videoId', (req, res) => sendShell(res, 'set.html'))
  app.get('/vendor/jquery.js', (req, res) => res.sendFile(jqueryPath))

  app.get('/api/link-preview', async (req, res) => {
    try {
      res.json(await fetchPreview(String(req.query.url || '')))
    } catch {
      res.status(204).end()
    }
  })

  app.get('/api/sets', (req, res) => {
    res.json(listSets())
  })

  app.post('/api/sets', async (req, res, next) => {
    try {
      const body = req.body || {}
      const title = typeof body.title === 'string' && body.title.trim()
        ? body.title
        : await lookupTitle(body.url)
      res.status(201).json(createSourceSet({ ...body, title }))
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/sets/:videoId/metadata', (req, res) => {
    res.json(getSourceSet(req.params.videoId))
  })

  app.patch('/api/sets/:videoId/metadata', async (req, res, next) => {
    try {
      const changes = { ...(req.body || {}) }
      if (typeof changes.title === 'string' && !changes.title.trim()) {
        const source = getSourceSet(req.params.videoId)
        changes.title = await lookupTitle(changes.sourceUrl || source.sourceUrl)
      }
      res.json(updateSourceSet(req.params.videoId, changes))
    } catch (err) {
      next(err)
    }
  })

  app.post('/api/sets/:videoId/download', async (req, res, next) => {
    try {
      const source = getSourceSet(req.params.videoId)
      const { startDownload } = await import('./processing.js')
      const status = startDownload(req.params.videoId, source.sourceUrl)
      res.json({ ...status, audioReady: status.audioExists ?? hasDownloadedAudio(req.params.videoId) })
    } catch (err) {
      next(err)
    }
  })

  app.post('/api/sets/:videoId/process', async (req, res, next) => {
    try {
      getSourceSet(req.params.videoId)
      const { startProcessing } = await import('./processing.js')
      const status = startProcessing(req.params.videoId)
      res.json({ ...status, audioReady: status.audioExists ?? hasDownloadedAudio(req.params.videoId) })
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/sets/:videoId/process', async (req, res, next) => {
    try {
      getSourceSet(req.params.videoId)
      const { getProcessingStatus } = await import('./processing.js')
      const status = getProcessingStatus(req.params.videoId)
      const hasResults = hasMergedResults(req.params.videoId)
      const audioReady = status?.audioExists ?? hasDownloadedAudio(req.params.videoId)
      const idleStatus = status?.status === 'idle'
        ? (audioReady
          ? { phase: 'download', status: 'completed', step: null }
          : { status: 'saved' })
        : (status || {})
      res.json({
        ...(hasResults ? { phase: 'process', status: 'completed', step: null } : idleStatus),
        status: hasResults ? 'completed' : (idleStatus.status || 'saved'),
        audioReady: !hasResults && audioReady,
      })
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/sets/:videoId/audio', (req, res, next) => {
    if (!/^[A-Za-z0-9_-]+$/.test(req.params.videoId)) {
      return next(Object.assign(new Error('invalid set id'), { code: 'invalid_video_id' }))
    }
    const audioDir = join(dataDir(), 'audio', req.params.videoId)
    const filename = existsSync(audioDir) ? readdirSync(audioDir).filter((name) => name.endsWith('.mp3')).sort()[0] : null
    if (!filename) return next(Object.assign(new Error(`no MP3 audio for set ${req.params.videoId}`), { code: 'missing_audio' }))
    res.type('audio/mpeg').sendFile(join(audioDir, filename), (err) => {
      if (err && !res.headersSent) next(err)
    })
  })

  app.get('/api/sets/:videoId', (req, res) => {
    res.json(getSet(req.params.videoId))
  })

  app.get('/api/sets/:videoId/export.csv', (req, res) => {
    const set = getSet(req.params.videoId)
    const fields = ['trackNo', 'cue', 'artists', 'title', 'isId', 'isIdVersion', 'link']
    const rows = exportableRows(set.rows)
    const csv = [fields, ...rows.map((row) => {
      const seconds = Math.round(row.start.seconds)
      const cue = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
        .map((part) => String(part).padStart(2, '0'))
        .join(':')
      return [
        row.number,
        cue,
        row.track.artists || '',
        row.track.title || '',
        !!row.track.isId,
        !!row.track.isIdVersion,
        row.track.links?.[0]?.url || '',
      ]
    })]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\r\n') + '\r\n'
    res.type('text/csv').attachment(`${encodeURIComponent(req.params.videoId)}.csv`).send(csv)
  })

  app.patch('/api/sets/:videoId/rows/:rowId', (req, res) => {
    res.json(updateRow(req.params.videoId, req.params.rowId, req.body))
  })

  app.post('/api/sets/:videoId/rows/:rowId/merge', (req, res) => {
    res.json(mergeRow(req.params.videoId, req.params.rowId, req.body.direction))
  })

  app.post('/api/sets/:videoId/rows/:rowId/insert', (req, res) => {
    res.json(insertEmptyRow(req.params.videoId, req.params.rowId, req.body.position))
  })

  app.delete('/api/sets/:videoId/rows/:rowId', (req, res) => {
    res.json(deleteRow(req.params.videoId, req.params.rowId))
  })

  app.delete('/api/sets/:videoId/rows/:rowId/post-1001', (req, res) => {
    res.json(clearPosted(req.params.videoId, req.params.rowId))
  })

  app.post('/api/sets/:videoId/rows/:rowId/post-1001', async (req, res, next) => {
    const { videoId, rowId } = req.params
    try {
      const set = getSet(videoId)
      const index = set.rows.findIndex((row) => row.id === rowId)
      if (index === -1) {
        throw Object.assign(new Error(`no row ${rowId} for video id ${videoId}`), { code: 'unknown_row' })
      }
      const row = set.rows[index]

      if (row.posted) {
        throw Object.assign(new Error(`row ${rowId} for video id ${videoId} is already posted`), { code: 'already_posted' })
      }
      if (!isReadyToPost(row, row.number)) {
        const message = row.number === null
          ? 'the row has no track number: a row above it is not complete'
          : 'row is not ready to post: missing link'
        throw Object.assign(new Error(message), { code: 'not_ready' })
      }
      const tracklistUrl = getTracklistUrl(videoId)
      if (!tracklistUrl) {
        throw Object.assign(
          new Error(`no tracklist URL for ${videoId}, add it on the set edit page`),
          { code: 'no_tracklist_url' },
        )
      }

      const trackNo = row.number - 1

      const logDir = join(dataDir(), '1001')
      const logPath = join(logDir, 'post-log.jsonl')
      function log(entry) {
        mkdirSync(logDir, { recursive: true })
        appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), videoId, rowId, trackNo, ...entry }) + '\n')
      }

      const paths = {
        cookies: join(dataDir(), 'cookies', '1001.cookies.txt'),
        fingerprint: join(dataDir(), '1001', 'browser.json'),
        screenshotDir: join(dataDir(), '1001', 'posts'),
      }

      const inFlightKey = `${videoId}/${rowId}`
      if (postsInFlight.has(inFlightKey)) {
        throw Object.assign(
          new Error(`a post for video id ${videoId} row ${rowId} is already running`),
          { code: 'post_in_progress' },
        )
      }
      postsInFlight.add(inFlightKey)
      let result
      try {
        result = await postRow({
          tracklistUrl,
          track: row.track,
          cueSeconds: row.start.seconds,
          trackNo,
          link: row.track.links && row.track.links[0] ? row.track.links[0] : undefined,
          paths,
          log,
        })
      } finally {
        postsInFlight.delete(inFlightKey)
      }

      res.json(
        markPosted(videoId, rowId, {
          at: new Date().toISOString(),
          suggestionId: result.suggestionId,
          siteRowId: result.siteRowId,
          trackNo,
          anchorTrackNo: result.trackNo,
          payload: result.payload,
          response: result.response,
        }),
      )
    } catch (err) {
      next(err)
    }
  })

  app.use(express.static(dir))

  app.use((err, req, res, next) => {
    const status = STATUS_BY_CODE[err.code] || err.status || err.statusCode || 500
    console.error(err.message)
    res.status(status).json({
      error: status === 500 ? 'internal error' : err.message,
      ...(status !== 500 && err.code ? { code: err.code } : {}),
    })
  })

  return app
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.SETBRAINZ_HOST || '0.0.0.0'
  const port = process.env.SETBRAINZ_PORT || 8765
  createApp().listen(port, host, () => {
    console.log(`Listening on http://${host}:${port}`)
  })
}
