import { test } from 'tap'
import { once } from 'node:events'
import { chromium } from 'playwright'
import { buildRealSlice } from './helpers/real-slice.js'
import { createApp } from '../app/server.js'

const FAKE_YT = `
window.YT = {
  PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  Player: class {
    constructor(id, options) {
      window.__fake = this
      this.state = -1
      this.time = 0
      this.calls = []
      this.options = options
    }
    seekTo(s) { this.calls.push('seek:' + s); this.time = s }
    playVideo() { this.calls.push('play'); this.state = 1 }
    pauseVideo() { this.calls.push('pause'); this.state = 2 }
    mute() { this.calls.push('mute') }
    unMute() { this.calls.push('unMute') }
    getCurrentTime() { return this.time }
    getPlayerState() { return this.state }
  },
}
setTimeout(() => window.onYouTubeIframeAPIReady(), 0)
`

const hms = (s) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':')

test('the set page, one browser and one page, in sequence', { bail: true, timeout: 240000 }, async (t) => {
  const { dir, videoId } = buildRealSlice(t)
  process.env.SETBRAINZ_DATA_DIR = dir

  const previews = []
  const app = createApp({
    fetchPreview: async (url) => {
      previews.push(url)
      return { title: 'Stub Title', artist: 'Stub Artist' }
    },
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.teardown(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}`

  const browser = await chromium.launch({ headless: true })
  t.teardown(() => browser.close())
  const page = await (await browser.newContext()).newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith(base)) return route.continue()
    if (url === 'https://www.youtube.com/iframe_api') return route.fulfill({ contentType: 'text/javascript', body: FAKE_YT })
    return route.abort()
  })

  const api = async (path, method = 'GET', body) => {
    const res = await fetch(`${base}/api/sets/${videoId}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}`)
    return res.json()
  }
  const settle = () => page.evaluate(() => new Promise((resolve) => {
    if (!$.active) return resolve()
    $(document).one('ajaxStop', () => resolve())
  }))
  const refresh = async () => {
    await page.evaluate(() => loadAndRender())
    await settle()
  }
  const rowSel = (row) => `tr[data-row-id="${row.id}"]`
  const fakeCalls = () => page.evaluate(() => window.__fake.calls.slice())
  const resetFake = (state, time) => page.evaluate(([s, tm]) => {
    window.__fake.calls.length = 0
    window.__fake.state = s
    window.__fake.time = tm
  }, [state, time])
  const toasts = () => page.$$eval('.toast', (els) => els.map((el) => el.textContent))
  const clearToasts = () => page.evaluate(() => $('#toasts').empty())

  await page.goto(`${base}/sets/${videoId}`)
  await page.waitForFunction(() => window.__fake && document.querySelector('#tracklist tbody tr'))
  await settle()

  let data = await api('')
  const variantTitles = (row) => row.rangeEntries.flatMap((e) => e.kind === 'track' ? e.variants.map((v) => v.title) : [])

  await t.test('the table draws one row for each decision row, with ready colour, number and decided mark', async (t) => {
    t.equal(await page.locator('#tracklist tbody tr').count(), data.rows.length)
    for (const row of data.rows) {
      const cls = await page.getAttribute(rowSel(row), 'class')
      t.equal(/\brow-ready\b/.test(cls), row.number !== null, `ready colour for number ${row.number}`)
      t.equal(/\bdecided\b/.test(cls), !!row.track)
    }
    const numbered = data.rows.filter((r) => r.number !== null)
    t.ok(numbered.length > 0, 'the slice holds numbered rows')
    t.match(await page.textContent(`${rowSel(numbered[0])} .row-number`), /^01/)
    t.end()
  })

  await t.test('the table shows every detection of the row span, saved or guessed', async (t) => {
    for (const row of data.rows) {
      const expected = [...new Set(variantTitles(row))].sort()
      const shown = await page.$$eval(`tr[data-row-id="${row.id}"] .open-dialog[data-title]`, (els) => els.map((el) => el.dataset.title))
      t.same([...new Set(shown)].sort(), expected, `row ${row.number ?? row.id}`)
    }
    t.end()
  })

  await t.test('the dialog lists the same detections and gaps as the row span, and Escape closes it', async (t) => {
    const row = data.rows.reduce((best, r) => (r.rangeEntries.length > best.rangeEntries.length ? r : best))
    t.ok(row.span, 'the row has a span')
    await page.click(`${rowSel(row)} td:nth-child(2) b .open-dialog`)
    t.ok(await page.isVisible('#track-dialog'))
    const items = await page.locator('#dialog-guesses li').count()
    t.equal(items, row.rangeEntries.reduce((n, e) => n + (e.kind === 'track' ? e.variants.length : 1), 0))
    const listed = await page.$$eval('#dialog-guesses .dialog-guess', (els) => els.map((el) => el.dataset.title))
    t.same(listed.sort(), variantTitles(row).sort())
    await page.keyboard.press('Escape')
    t.notOk(await page.isVisible('#track-dialog'))
    t.end()
  })

  await t.test('a click on a guess in the table fills the dialog, and a click on a detection in the dialog refills it', async (t) => {
    const row = data.rows.find((r) => variantTitles(r).length >= 2)
    t.ok(row, 'a row with two detections exists')
    await page.click(`${rowSel(row)} td.guesses .open-dialog >> nth=0`)
    const guessTitle = await page.inputValue('#track-dialog [name=title]')
    t.ok(variantTitles(row).includes(guessTitle))
    const other = page.locator('#dialog-guesses .dialog-guess').last()
    const otherTitle = await other.getAttribute('data-title')
    const otherArtist = await other.getAttribute('data-artists')
    await other.click()
    t.equal(await page.inputValue('#track-dialog [name=title]'), otherTitle)
    t.equal(await page.inputValue('#track-dialog [name=artists]'), otherArtist)
    await page.click('#track-cancel')
    t.same((await api('')).rows.find((r) => r.id === row.id).track, row.track, 'Cancel saved nothing')
    t.end()
  })

  await t.test('the Link field has the width of the other fields, and the preview shows below it from the stub', async (t) => {
    await page.click(`${rowSel(data.rows[0])} td:nth-child(2) b .open-dialog`)
    const box = (sel) => page.$eval(sel, (el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    })
    const link = await box('#track-dialog [name=link]')
    const artists = await box('#track-dialog [name=artists]')
    t.equal(Math.round(link.left), Math.round(artists.left))
    t.equal(Math.round(link.right), Math.round(artists.right))

    await page.fill('#track-dialog [name=link]', 'not a link')
    t.equal(await page.textContent('#track-dialog .link-preview'), '')
    t.equal(previews.length, 0, 'no request for text that is not a web address')

    await page.fill('#track-dialog [name=link]', 'https://example.test/track/1')
    await page.waitForFunction(() => document.querySelector('#track-dialog .link-preview').textContent !== '')
    t.equal(await page.textContent('#track-dialog .link-preview'), 'Stub Title — Stub Artist')
    t.same(previews, ['https://example.test/track/1'])
    const preview = await box('#track-dialog .link-preview')
    t.ok(preview.bottom > link.bottom && preview.top >= (link.top + link.bottom) / 2, 'the preview sits below the field')

    await page.fill('#track-dialog [name=link]', '')
    t.equal(await page.textContent('#track-dialog .link-preview'), '')
    await page.click('#track-cancel')
    t.end()
  })

  await t.test('Save writes the track, link kind, note and typed cue, and the row redraws; a bad cue keeps the dialog open', async (t) => {
    await api('/rows/' + data.rows[1].id, 'PATCH', { start: null, track: null, note: '' })
    await refresh()
    const row = data.rows[1]
    await page.click(`${rowSel(row)} td:nth-child(2) b .open-dialog`)
    await page.fill('#track-dialog [name=cue]', 'bad')
    await page.fill('#track-dialog [name=artists]', 'Typed Artist')
    await page.fill('#track-dialog [name=title]', 'Typed Title')
    await page.click('#track-form button[type=submit]')
    await page.waitForSelector('.toast')
    t.ok(await page.isVisible('#track-dialog'), 'the dialog stays open')
    t.match((await toasts()).join(' '), /cue must be/)
    await clearToasts()

    await page.fill('#track-dialog [name=cue]', '0:07:30')
    await page.fill('#track-dialog [name=link]', 'https://open.spotify.com/track/TESTTRACK01')
    await page.fill('#track-dialog [name=note]', 'typed note')
    await Promise.all([page.waitForResponse((r) => r.request().method() === 'PATCH'), page.click('#track-form button[type=submit]')])
    await settle()
    t.notOk(await page.isVisible('#track-dialog'))
    const saved = (await api('')).rows.find((r) => r.id === row.id)
    t.match(saved.start, { seconds: 450, from: 'typed' })
    t.match(saved.track, { artists: 'Typed Artist', title: 'Typed Title', links: [{ kind: 'spotify' }] })
    t.equal(saved.note, 'typed note')
    t.match(await page.textContent(`${rowSel(row)} td:nth-child(2)`), /Typed Title/)
    t.match(await page.getAttribute(`${rowSel(row)} a.jump-link.big`, 'data-t'), /^450$/)
    t.end()
  })

  const reset = async () => {
    for (const row of (await api('')).rows) await api('/rows/' + row.id, 'PATCH', { start: null, track: null, note: '' })
    data = await api('')
    await refresh()
  }
  await reset()
  const index = data.rows.findIndex((r, i) => i >= 2 && i < data.rows.length - 2 && r.merged.length && r.merged.every((m) => m.kind === 'track'))
  t.ok(index > 0, 'a plain track row exists in the slice')
  const target = () => data.rows[index]

  await t.test('the seek buttons move the player by -10, -1, +1 and +10 seconds, never below zero, and save the position', async (t) => {
    await resetFake(1, 100)
    for (const [delta, expected] of [['-10', 90], ['-1', 89], ['1', 90], ['10', 100]]) {
      await page.click(`button[data-seek="${delta}"]`)
      t.equal(await page.evaluate(() => window.__fake.time), expected, `${delta} seconds`)
      t.equal(await page.evaluate((k) => localStorage.getItem(k), `sb-position:${videoId}`), String(expected))
    }
    await resetFake(1, 5)
    await page.click('button[data-seek="-10"]')
    t.equal(await page.evaluate(() => window.__fake.time), 0)
    t.end()
  })

  await t.test('a plain click on a time reads the player state: it plays an unstarted player, only seeks a playing or paused one', async (t) => {
    const small = `${rowSel(target())} a.jump-link.earliest`
    const seconds = Number(await page.getAttribute(small, 'data-t'))
    await resetFake(-1, 0)
    await page.click(small)
    t.same(await fakeCalls(), [`seek:${seconds}`, 'play'])
    await page.click(`${rowSel(target())} a.jump-link.latest`)
    t.equal((await fakeCalls()).filter((c) => c === 'play').length, 1, 'a playing player gets no second play')
    await resetFake(2, 0)
    await page.click(small)
    t.same(await fakeCalls(), [`seek:${seconds}`], 'a paused player is not forced to play')
    t.end()
  })

  await t.test('a click on a time, with or without shift, saves no decision', async (t) => {
    const small = `${rowSel(target())} a.jump-link.earliest`
    await page.keyboard.down('Shift')
    await page.click(small)
    await page.keyboard.up('Shift')
    await settle()
    t.equal((await api('')).rows[index].start, null)
    t.end()
  })

  await t.test('a decided row hides its small times and shows undo; undo brings the computed times back', async (t) => {
    const row = rowSel(target())
    const seconds = Number(await page.getAttribute(`${row} a.jump-link.earliest`, 'data-t'))
    await api('/rows/' + target().id, 'PATCH', { start: { seconds, from: 'earliest' } })
    await refresh()
    t.equal(await page.locator(`${row} a.jump-link.earliest`).count(), 0)
    t.match(await page.getAttribute(`${row} a.jump-link.big`, 'class'), /\bdecided\b/)
    t.equal(await page.getAttribute(`${row} a.jump-link.big`, 'data-t'), String(seconds))
    await page.click(`${row} a.undo-link`)
    await settle()
    t.notMatch(await page.getAttribute(`${row} a.jump-link.big`, 'class'), /\bdecided\b/)
    t.equal(await page.locator(`${row} a.jump-link.earliest`).count(), 1)
    t.equal((await api('')).rows[index].start, null)
    t.end()
  })

  await t.test('the first decided row keeps a 00:00:00 link beside undo, a later decided row shows only undo', async (t) => {
    await api('/rows/' + data.rows[0].id, 'PATCH', { start: { seconds: 3, from: 'typed' } })
    await api('/rows/' + target().id, 'PATCH', { start: { seconds: 900, from: 'typed' } })
    await refresh()
    const first = await page.innerHTML(`${rowSel(data.rows[0])} .jump .small`)
    t.match(first, /data-t="0"/)
    t.match(first, /undo-link/)
    const later = await page.innerHTML(`${rowSel(target())} .jump .small`)
    t.notMatch(later, /data-t="0"/)
    t.match(later, /undo-link/)
    t.end()
  })

  await t.test('grab saves the time of a paused player and keeps the guess of the row; a playing player saves nothing and shows a message', async (t) => {
    await api('/rows/' + target().id, 'PATCH', { start: null })
    await refresh()
    const row = rowSel(target())
    const titleBefore = await page.textContent(`${row} td:nth-child(2) b`)
    const guessesBefore = await page.$$eval(`${row} td.guesses .open-dialog`, (els) => els.map((el) => el.dataset.title))
    const grabAt = Math.round(target().span.start) + 7

    await resetFake(1, grabAt)
    await clearToasts()
    await page.click(`${row} a.grab-link`)
    t.match((await toasts()).join(' '), /Pause the player/)
    t.equal((await api('')).rows[index].start, null)

    await resetFake(2, grabAt)
    await page.click(`${row} a.grab-link`)
    await settle()
    t.match((await api('')).rows[index].start, { seconds: grabAt, from: 'grab' })
    t.equal(await page.textContent(`${row} td:nth-child(2) b`), titleBefore, 'the guess stays in Track')
    t.match(await page.getAttribute(`${row} a.jump-link.big`, 'class'), /\bdecided\b/)
    t.ok(guessesBefore.every((title) => title !== undefined))
    t.equal(await page.locator(`${row} td:nth-child(2) b .open-dialog[data-title]`).count(), 1)
    t.end()
  })

  await t.test('an added empty row has no span and does not change the detections of the row above', async (t) => {
    const aboveBefore = await page.$$eval(`${rowSel(target())} .open-dialog[data-title]`, (els) => els.map((el) => el.dataset.title))
    await page.click(`${rowSel(target())} a.action-insert-below`)
    await settle()
    const after = await api('')
    const added = after.rows[index + 1]
    t.equal(added.span, null)
    t.same(added.sources, [])
    t.equal(await page.locator(`${rowSel(added)} .open-dialog[data-title]`).count(), 0)
    const aboveAfter = await page.$$eval(`${rowSel(after.rows[index])} .open-dialog[data-title]`, (els) => els.map((el) => el.dataset.title))
    t.same(aboveAfter.sort(), aboveBefore.sort())
    await page.click(`${rowSel(added)} a.action-delete`)
    await settle()
    t.equal((await api('')).rows.length, data.rows.length)
    t.end()
  })

  await t.test('a decided track shows the words of the owner and hides the evidence line of the guess', async (t) => {
    const row = rowSel(target())
    await api('/rows/' + target().id, 'PATCH', { track: { artists: 'Real Artist', title: 'Real Title' } })
    await refresh()
    const cell = await page.textContent(`${row} td:nth-child(2)`)
    t.match(cell, /Real Title/)
    t.match(cell, /Real Artist/)
    const primary = variantTitles(target())[0]
    t.notMatch(cell, new RegExp(primary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the guess is not in Track')
    t.notMatch(cell, /\bT \d+×|\bR \d+ chunks/, 'no evidence line in Track')
    const guessText = await page.$$eval(`${row} td.guesses .guess`, (els) => els.map((el) => el.textContent))
    t.ok(guessText.length > 0 && guessText.some((g) => /\bT \d+×|\bR \d+ chunks/.test(g)), 'a guess in Other guesses keeps its evidence')
    t.match(await page.getAttribute(row, 'class'), /\bdecided\b/)
    t.end()
  })

  await t.test('a decided row with a link shows the service name as an always visible link; no link shows none', async (t) => {
    const row = rowSel(target())
    const cases = [
      ['spotify', 'https://open.spotify.com/track/TESTTRACK01', 'Spotify'],
      ['other', 'https://www.beatport.com/track/test/1', 'beatport'],
      ['other', 'https://shop.example.co.uk/x', 'example'],
    ]
    for (const [kind, url, name] of cases) {
      await api('/rows/' + target().id, 'PATCH', { track: { artists: 'Link Artist', title: 'Link Title', links: [{ kind, url }] } })
      await refresh()
      const link = page.locator(`${row} td:nth-child(2) .confirmed-link a`)
      t.equal(await link.textContent(), name)
      t.equal(await link.getAttribute('href'), url)
      t.equal(await link.getAttribute('target'), '_blank')
      t.equal(await link.getAttribute('rel'), 'noopener')
      t.ok(await link.isVisible(), 'visible without hover')
    }
    await api('/rows/' + target().id, 'PATCH', { track: { artists: 'Link Artist', title: 'Link Title', links: [] } })
    await refresh()
    t.equal(await page.locator(`${row} .confirmed-link`).count(), 0)
    t.end()
  })

  await t.test('a saved track that matches a guess shows that guess below it and hides it from Other guesses', async (t) => {
    const row = rowSel(target())
    const variant = target().rangeEntries.flatMap((e) => e.kind === 'track' ? e.variants : [])[0]
    await api('/rows/' + target().id, 'PATCH', { track: { artists: variant.artist, title: variant.title.toUpperCase() } })
    await refresh()
    t.equal(await page.locator(`${row} .winning-guess`).count(), 1)
    t.match(await page.textContent(`${row} .winning-guess`), new RegExp(variant.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    t.equal(await page.locator(`${row} td.guesses .guess`).filter({ hasText: variant.title }).count(), 0)
    t.end()
  })

  await t.test('a failed save shows a message with the status code', async (t) => {
    await reset()
    const row = data.rows[data.rows.length - 1]
    await api('/rows/' + row.id, 'DELETE')
    await clearToasts()
    await page.click(`${rowSel(row)} a.grab-link`)
    await settle()
    t.match((await toasts()).join(' '), /404/)
    await refresh()
    data = await api('')
    t.end()
  })

  await t.test('the space bar plays and pauses, but not while the dialog is open or the user types', async (t) => {
    await resetFake(2, 0)
    await page.evaluate(() => document.activeElement && document.activeElement.blur())
    await page.keyboard.press('Space')
    t.same(await fakeCalls(), ['play'])
    await page.keyboard.press('Space')
    t.same(await fakeCalls(), ['play', 'pause'])

    await resetFake(2, 0)
    await page.click(`${rowSel(data.rows[0])} td:nth-child(2) b .open-dialog`)
    await page.keyboard.press('Space')
    t.same(await fakeCalls(), [], 'nothing while the dialog is open')
    await page.fill('#track-dialog [name=note]', 'a b')
    t.same(await fakeCalls(), [])
    await page.keyboard.press('Escape')

    await page.evaluate(() => {
      const input = document.createElement('input')
      input.id = 'typing'
      document.body.append(input)
      input.focus()
    })
    await page.keyboard.press('Space')
    t.same(await fakeCalls(), [], 'nothing while the user types in an input')
    await page.evaluate(() => document.getElementById('typing').remove())
    t.end()
  })

  await t.test('the saved position names its own video', async (t) => {
    t.equal(await page.evaluate(() => POSITION_KEY), `sb-position:${videoId}`)
    await page.evaluate(() => savePosition(77))
    t.equal(await page.evaluate((k) => localStorage.getItem(k), `sb-position:${videoId}`), '77')
    await page.evaluate(() => localStorage.setItem('sb-position:OTHERVIDEO01', '200'))
    t.equal(await page.evaluate(() => loadSavedPosition()), 77)
    t.equal(await page.evaluate(() => localStorage.getItem('sb-position:OTHERVIDEO01')), '200')
    t.end()
  })

  await t.test('on load a saved position mutes, plays, seeks, pauses and unmutes once; none or zero leaves the player alone', async (t) => {
    const key = `sb-position:${videoId}`
    await page.evaluate((k) => localStorage.removeItem(k), key)
    await resetFake(-1, 0)
    await page.evaluate(() => onPlayerReady())
    t.same(await fakeCalls(), [])

    await page.evaluate((k) => localStorage.setItem(k, '0'), key)
    await page.evaluate(() => onPlayerReady())
    t.same(await fakeCalls(), [])

    await page.evaluate((k) => localStorage.setItem(k, '55'), key)
    await page.evaluate(() => onPlayerReady())
    t.same(await fakeCalls(), ['mute', 'play'])
    t.equal(await page.evaluate(() => restoringPosition), 55)
    await page.evaluate(() => onPlayerStateChange({ data: YT.PlayerState.PLAYING }))
    t.same(await fakeCalls(), ['mute', 'play', 'seek:55', 'pause'])
    t.equal(await page.evaluate((k) => localStorage.getItem(k), key), '55', 'the page does not save an unsettled time')
    await page.evaluate(() => onPlayerStateChange({ data: YT.PlayerState.PAUSED }))
    t.same(await fakeCalls(), ['mute', 'play', 'seek:55', 'pause', 'unMute'])
    t.equal(await page.evaluate(() => restoringPosition), 0)
    t.end()
  })

  t.same(pageErrors, [], 'the page raised no script error')
})
