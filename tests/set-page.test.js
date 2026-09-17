import { test } from 'tap'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { makeEmptyDataDir, makeMergedRow, writeMergedFile } from './helpers/fixtures.js'
import { createApp } from '../app/server.js'

function playwrightCliAvailable() {
  try {
    execFileSync('playwright-cli', ['--version'], { stdio: 'ignore', timeout: 15000 })
    return true
  } catch {
    return false
  }
}

const skipReason = playwrightCliAvailable()
  ? false
  : 'playwright-cli is not on PATH; install it with `npm install -g @playwright/cli@latest` to run this test'

async function startServer(t, dir) {
  process.env.SETBRAINZ_DATA_DIR = dir
  const app = createApp()
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.teardown(() => server.close())
  return `http://127.0.0.1:${server.address().port}`
}

function pw(session, args, timeout = 10000) {
  execFileSync('playwright-cli', ['cli', '-s', session, ...args], { stdio: 'ignore', timeout })
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
  const child = spawn('playwright-cli', ['cli', '-s', session, 'open', '--browser=chromium', '--no-headed', url], {
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

function installSeekSpy(session) {
  pwEval(session, "(() => { player = { seekCalls: 0, seekTo() { this.seekCalls++ }, playVideo(){}, getCurrentTime(){ return 0 }, getPlayerState(){ return 2 } }; return 'ok' })()")
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

test('a track row shows the words of the user, not the guess (functional)', { skip: skipReason }, async (t) => {
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

test('a decided start can be cleared, and the row then shows its computed times again (functional)', { skip: skipReason }, async (t) => {
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

test('a plain click moves the player, and a shift click on a small timestamp saves a decision without moving it (functional)', { skip: skipReason }, async (t) => {
  const dir = makeEmptyDataDir(t)
  const videoId = 'TESTVIDEO52'
  writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
  const base = await startServer(t, dir)

  const session = await openPage(t, `${base}/sets/${videoId}`)
  await waitUntil(() => pwEval(session, "document.querySelector('a.jump-link.earliest') !== null"))
  installSeekSpy(session)

  pw(session, ['click', 'a.jump-link.best'])
  await wait(300)
  t.equal(pwEval(session, 'player.seekCalls'), 1)

  shiftClick(session, 'a.jump-link.earliest')
  await waitUntil(async () => {
    const data = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    return data.rows[0].start !== null
  })

  const after = await (await fetch(`${base}/api/sets/${videoId}`)).json()
  t.match(after.rows[0].start, { from: 'earliest' })
  t.equal(pwEval(session, 'player.seekCalls'), 1)
  t.end()
})

test('the saved position key names its own video, so a second video never clashes (functional)', { skip: skipReason }, async (t) => {
  const dir = makeEmptyDataDir(t)
  const videoId = 'TESTVIDEO53'
  writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
  const base = await startServer(t, dir)

  const session = await openPage(t, `${base}/sets/${videoId}`)
  await waitUntil(() => pwEval(session, "document.querySelector('tbody tr') !== null"))

  t.equal(pwEval(session, 'POSITION_KEY'), 'sb-position:TESTVIDEO53')
  pwEval(session, '(() => { savePosition(77); return "ok" })()')
  t.equal(pwEval(session, "localStorage.getItem('sb-position:TESTVIDEO53')"), '77')

  pwEval(session, "(() => { localStorage.setItem('sb-position:TESTVIDEO54', '200'); return 'ok' })()")
  t.equal(pwEval(session, 'loadSavedPosition()'), 77)
  t.equal(pwEval(session, "localStorage.getItem('sb-position:TESTVIDEO54')"), '200')
  t.end()
})

test('on load, a saved position mutes, plays, seeks, pauses and unmutes once; no saved position or a saved zero leaves the player alone (functional)', { skip: skipReason }, async (t) => {
  const dir = makeEmptyDataDir(t)
  const videoId = 'TESTVIDEO57'
  writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
  const base = await startServer(t, dir)

  const session = await openPage(t, `${base}/sets/${videoId}`)
  await waitUntil(() => pwEval(session, "document.querySelector('tbody tr') !== null"))

  pwEval(session, `(() => {
    window.__calls = []
    player = {
      mute() { window.__calls.push('mute') },
      unMute() { window.__calls.push('unMute') },
      playVideo() { window.__calls.push('playVideo') },
      pauseVideo() { window.__calls.push('pauseVideo') },
      seekTo(s) { window.__calls.push('seekTo:' + s) },
      getCurrentTime() { return 0 },
    }
    return 'ok'
  })()`)

  const noneResult = pwEval(session, '(() => { onPlayerReady(); return [...window.__calls] })()')
  t.same(noneResult, [])

  pwEval(session, "(() => { localStorage.setItem('sb-position:TESTVIDEO57', '0'); window.__calls = []; return 'ok' })()")
  const zeroResult = pwEval(session, '(() => { onPlayerReady(); return [...window.__calls] })()')
  t.same(zeroResult, [])

  pwEval(session, "(() => { localStorage.setItem('sb-position:TESTVIDEO57', '55'); window.__calls = []; return 'ok' })()")
  const snapshot = pwEval(session, `(() => {
    onPlayerReady()
    const afterReady = { restoring: restoringPosition, calls: [...window.__calls] }
    onPlayerStateChange({ data: YT.PlayerState.PLAYING })
    const afterPlaying = { restoring: restoringPosition, calls: [...window.__calls] }
    onPlayerStateChange({ data: YT.PlayerState.PAUSED })
    const afterPaused = { restoring: restoringPosition, calls: [...window.__calls] }
    return { afterReady, afterPlaying, afterPaused }
  })()`)

  t.equal(snapshot.afterReady.restoring, 55)
  t.same(snapshot.afterReady.calls, ['mute', 'playVideo'])

  // getCurrentTime always answers 0 here. This stands in for a seekTo that has
  // not settled. The page must not save that time over the saved position.
  t.equal(snapshot.afterPlaying.restoring, 55)
  t.same(snapshot.afterPlaying.calls, ['mute', 'playVideo', 'seekTo:55', 'pauseVideo'])
  t.equal(pwEval(session, "localStorage.getItem('sb-position:TESTVIDEO57')"), '55')

  t.equal(snapshot.afterPaused.restoring, 0)
  t.same(snapshot.afterPaused.calls, ['mute', 'playVideo', 'seekTo:55', 'pauseVideo', 'unMute'])
  t.equal(pwEval(session, "localStorage.getItem('sb-position:TESTVIDEO57')"), '55')
  t.end()
})

test('a row is coloured ready only when it holds a decided start and a postable track (functional)', { skip: skipReason }, async (t) => {
  const dir = makeEmptyDataDir(t)
  const videoId = 'TESTVIDEO55'
  writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow(), makeMergedRow(), makeMergedRow()] })
  const base = await startServer(t, dir)
  const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
  const [readyRowId, startOnlyRowId, trackOnlyRowId] = before.rows.map((r) => r.id)

  await fetch(`${base}/api/sets/${videoId}/rows/${readyRowId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ start: { seconds: 5, from: 'best' }, track: { artists: 'Real Artist', title: 'Real Title' } }),
  })
  await fetch(`${base}/api/sets/${videoId}/rows/${startOnlyRowId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ start: { seconds: 5, from: 'best' } }),
  })
  await fetch(`${base}/api/sets/${videoId}/rows/${trackOnlyRowId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track: { artists: 'Real Artist', title: 'Real Title' } }),
  })

  const session = await openPage(t, `${base}/sets/${videoId}`)
  await waitUntil(() => pwEval(session, "document.querySelectorAll('tbody tr').length === 3"))

  const classOf = (rowId) => pwEval(session, `document.querySelector('tr[data-row-id="${rowId}"]').className`)
  t.match(classOf(readyRowId), /\brow-ready\b/)
  t.notMatch(classOf(startOnlyRowId), /\brow-ready\b/)
  t.notMatch(classOf(trackOnlyRowId), /\brow-ready\b/)
  t.end()
})
