import express from 'express'
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listSets, getSet, updateRow, mergeRow, insertEmptyRow, deleteRow, markPosted, isReadyToPost } from './store.js'
import { postRow as realPostRow } from './1001-post.js'

const require = createRequire(import.meta.url)
const defaultPublicDir = join(dirname(fileURLToPath(import.meta.url)), 'public')
const jqueryPath = require.resolve('jquery/dist/jquery.js')

function publicDir() {
  return process.env.SETBRAINZ_PUBLIC_DIR || defaultPublicDir
}

function dataDir() {
  return process.env.SETBRAINZ_DATA_DIR || 'data'
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
  id_post_not_implemented: 400,
  no_tracklist_url: 400,
  posted_is_read_only: 400,
  already_posted: 409,
  post_in_progress: 409,
  already_suggested: 409,
  row_taken: 409,
  position_gap: 400,
  unsupported_link: 400,
  not_logged_in: 502,
  challenge_page: 502,
  no_site_rows: 502,
  site_rejected: 502,
  bad_response: 502,
}

const postsInFlight = new Set()

export function createApp({ postRow = realPostRow } = {}) {
  const app = express()
  const dir = publicDir()

  function sendShell(res, filename) {
    res.sendFile(join(dir, filename), (err) => {
      if (err && !res.headersSent) res.status(404).end()
    })
  }

  app.use(express.json())

  app.get('/', (req, res) => sendShell(res, 'index.html'))
  app.get('/sets/:videoId', (req, res) => sendShell(res, 'set.html'))
  app.get('/vendor/jquery.js', (req, res) => res.sendFile(jqueryPath))

  app.get('/api/sets', (req, res) => {
    res.json(listSets())
  })

  app.get('/api/sets/:videoId', (req, res) => {
    res.json(getSet(req.params.videoId))
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
      if (row.track.isId) {
        throw Object.assign(new Error('posting an ID row is not built yet'), { code: 'id_post_not_implemented' })
      }

      const tracklistsPath = join(dataDir(), '1001', 'tracklists.json')
      const tracklistMap = existsSync(tracklistsPath) ? JSON.parse(readFileSync(tracklistsPath, 'utf8')) : {}
      const tracklistUrl = tracklistMap[videoId]
      if (!tracklistUrl) {
        throw Object.assign(
          new Error(`no tracklist url for ${videoId}, add it to ${tracklistsPath}`),
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
          link: row.track.links[0],
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
          trackNo: result.trackNo,
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
