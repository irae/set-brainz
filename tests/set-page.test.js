import { test } from 'tap'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { makeEmptyDataDir, makeMergedRow, writeMergedFile } from './helpers/fixtures.js'
import { createApp } from '../app/server.js'

async function startServer(t, dir) {
  process.env.SETBRAINZ_DATA_DIR = dir
  const app = createApp()
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.teardown(() => server.close())
  return `http://127.0.0.1:${server.address().port}`
}

function pw(session, args) {
  execFileSync('playwright-cli', ['cli', '-s', session, ...args], { stdio: 'ignore', timeout: 10000 })
}

function pwEval(session, expr) {
  const out = execFileSync('playwright-cli', ['cli', '--raw', '-s', session, 'eval', expr], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10000,
  })
  return JSON.parse(out.trim())
}

async function openPage(t, url) {
  const session = `sb-${randomUUID().slice(0, 8)}`
  const child = spawn('playwright-cli', ['cli', '-s', session, 'open', '--browser=chromium', url], {
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
  t.teardown(() => pw(session, ['close']))

  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      pwEval(session, '1')
      return session
    } catch {
      await wait(500)
    }
  }
  throw new Error('timed out opening the headless browser session')
}

function shiftClick(session, selector) {
  pw(session, ['keydown', 'Shift'])
  pw(session, ['click', selector])
  pw(session, ['keyup', 'Shift'])
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntil(fn) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await fn()) return
    await wait(200)
  }
  throw new Error('timed out waiting for the page to update')
}

test('a track row shows the words of the user, not the guess (functional)', async (t) => {
  const dir = makeEmptyDataDir(t)
  const videoId = 'TESTVIDEO50'
  writeMergedFile(dir, videoId, '20260101T000000Z-x.json', {
    rows: [makeMergedRow({
      variants: [{
        title: 'Shazam Guess Title',
        artist: 'Shazam Guess Artist',
        start: 5,
        end: 20,
        tracklistify: [],
        ripthatset: [],
      }],
    })],
  })
  const base = await startServer(t, dir)
  const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
  const rowId = before.rows[0].id
  await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track: { artists: 'Real Artist', title: 'Real Title' } }),
  })

  const session = await openPage(t, `${base}/sets/${videoId}`)
  await waitUntil(() => pwEval(session, "document.querySelector('tbody tr') !== null"))
  const titleCellText = pwEval(session, "document.querySelector('tbody tr td:nth-child(2)').textContent")

  t.match(titleCellText, /Real Title/)
  t.match(titleCellText, /Real Artist/)
  t.notMatch(titleCellText, /Shazam Guess Title/)
  t.notMatch(titleCellText, /Shazam Guess Artist/)
  t.end()
})

test('a decided start can be cleared, and the row then shows its computed times again (functional)', async (t) => {
  const dir = makeEmptyDataDir(t)
  const videoId = 'TESTVIDEO51'
  writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
  const base = await startServer(t, dir)
  const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
  const rowId = before.rows[0].id
  await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ start: { seconds: 42, from: 'best' } }),
  })

  const session = await openPage(t, `${base}/sets/${videoId}`)
  await waitUntil(() => pwEval(session, "document.querySelector('a.jump-link.big') !== null"))
  const decidedHtml = pwEval(session, "document.querySelector('a.jump-link.big').outerHTML")
  t.match(decidedHtml, /\bdecided\b/)
  t.match(decidedHtml, /data-t="42"/)

  shiftClick(session, 'a.jump-link.big.decided')
  await waitUntil(() => !pwEval(session, "document.querySelector('a.jump-link.big').outerHTML").includes('decided'))

  const clearedHtml = pwEval(session, "document.querySelector('a.jump-link.big').outerHTML")
  t.notMatch(clearedHtml, /\bdecided\b/)
  t.match(clearedHtml, /data-t="0"/)
  t.end()
})
