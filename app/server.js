import express from 'express'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listSets, getSet, updateRow, mergeRow, insertEmptyRow, deleteRow } from './store.js'

const require = createRequire(import.meta.url)
const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public')
const jqueryPath = require.resolve('jquery/dist/jquery.js')

function sendShell(res, filename) {
  res.sendFile(join(publicDir, filename), (err) => {
    if (err && !res.headersSent) res.status(404).end()
  })
}

function sendStoreError(res, err) {
  const isNotFound = err.message.startsWith('no merged results for video id') || err.message.startsWith('no row ')
  res.status(isNotFound ? 404 : 400).json({ error: err.message })
}

export function createApp() {
  const app = express()
  app.use(express.json())

  app.get('/', (req, res) => sendShell(res, 'index.html'))
  app.get('/sets/:videoId', (req, res) => sendShell(res, 'set.html'))
  app.get('/vendor/jquery.js', (req, res) => res.sendFile(jqueryPath))

  app.get('/api/sets', (req, res) => {
    res.json(listSets())
  })

  app.get('/api/sets/:videoId', (req, res) => {
    try {
      res.json(getSet(req.params.videoId))
    } catch (err) {
      sendStoreError(res, err)
    }
  })

  app.patch('/api/sets/:videoId/rows/:rowId', (req, res) => {
    try {
      res.json(updateRow(req.params.videoId, req.params.rowId, req.body))
    } catch (err) {
      sendStoreError(res, err)
    }
  })

  app.post('/api/sets/:videoId/rows/:rowId/merge', (req, res) => {
    try {
      res.json(mergeRow(req.params.videoId, req.params.rowId, req.body.direction))
    } catch (err) {
      sendStoreError(res, err)
    }
  })

  app.post('/api/sets/:videoId/rows/:rowId/insert', (req, res) => {
    try {
      res.json(insertEmptyRow(req.params.videoId, req.params.rowId, req.body.position))
    } catch (err) {
      sendStoreError(res, err)
    }
  })

  app.delete('/api/sets/:videoId/rows/:rowId', (req, res) => {
    try {
      res.json(deleteRow(req.params.videoId, req.params.rowId))
    } catch (err) {
      sendStoreError(res, err)
    }
  })

  app.use(express.static(publicDir))

  return app
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(8765, '127.0.0.1', () => {
    console.log('Listening on http://127.0.0.1:8765')
  })
}
