import express from 'express'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listSets, getSet, updateRow, mergeRow, insertEmptyRow, deleteRow } from './store.js'

const require = createRequire(import.meta.url)
const defaultPublicDir = join(dirname(fileURLToPath(import.meta.url)), 'public')
const jqueryPath = require.resolve('jquery/dist/jquery.js')

function publicDir() {
  return process.env.SETBRAINZ_PUBLIC_DIR || defaultPublicDir
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
}

export function createApp() {
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

  app.use(express.static(dir))

  app.use((err, req, res, next) => {
    const status = STATUS_BY_CODE[err.code] || err.status || err.statusCode || 500
    console.error(err.message)
    res.status(status).json({ error: status === 500 ? 'internal error' : err.message })
  })

  return app
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(8765, '127.0.0.1', () => {
    console.log('Listening on http://127.0.0.1:8765')
  })
}
