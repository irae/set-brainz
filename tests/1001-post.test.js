import { test } from 'tap'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeNetscapeCookies } from '../app/1001-session.js'
import { saveSession } from '../app/1001-session.js'
import {
  suggestionText,
  linkType,
  chooseTarget,
  buildPayload,
} from '../app/1001-post.js'

test('suggestionText joins artist and title without a version', (t) => {
  const text = suggestionText({ artists: ' Darco & DvirNuns ', title: ' Saying Hey! ', version: '' })
  t.equal(text, 'Darco & DvirNuns - Saying Hey!')
  t.end()
})

test('suggestionText appends the version in parentheses', (t) => {
  const text = suggestionText({ artists: 'Darco & DvirNuns', title: 'Saying Hey!', version: ' Extended Mix ' })
  t.equal(text, 'Darco & DvirNuns - Saying Hey! (Extended Mix)')
  t.end()
})

test('linkType maps YouTube hosts to 13', (t) => {
  t.equal(linkType('https://www.youtube.com/watch?v=1'), 13)
  t.equal(linkType('https://youtu.be/abc'), 13)
  t.equal(linkType('https://music.youtube.com/watch?v=1'), 13)
  t.end()
})

test('linkType maps Spotify and Apple Music hosts to 10', (t) => {
  t.equal(linkType('https://open.spotify.com/track/xyz'), 10)
  t.equal(linkType('https://music.apple.com/us/album/x'), 10)
  t.end()
})

test('linkType throws unsupported_link for any other host', (t) => {
  t.throws(() => linkType('https://example.com/track'), /unsupported_link/)
  t.end()
})

test('chooseTarget returns an id target when the row already exists', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0 },
    { idTLP: 222, trackNo: 1 },
  ]
  const target = chooseTarget(siteRows, 1)
  t.same(target, { type: 'id', sugType: 0, idTLP: 222, trackNo: 1, isID: true })
  t.end()
})

test('chooseTarget returns an add target for the row right after the last', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0 },
    { idTLP: 222, trackNo: 1 },
  ]
  const target = chooseTarget(siteRows, 2)
  t.same(target, { type: 'add', sugType: 3, idTLP: 222, trackNo: 1, isID: true })
  t.end()
})

test('chooseTarget throws position_gap when trackNo is too far ahead', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0 },
    { idTLP: 222, trackNo: 1 },
  ]
  t.throws(() => chooseTarget(siteRows, 5), /position_gap/)
  try {
    chooseTarget(siteRows, 5)
    t.fail('should have thrown')
  } catch (err) {
    t.match(err.message, /5/)
    t.match(err.message, /2/)
  }
  t.end()
})

test('buildPayload orders keys and rounds the cue', (t) => {
  const target = { type: 'id', sugType: 0, idTLP: 14375750, trackNo: 0, isID: true }
  const track = { artists: 'Darco & DvirNuns', title: 'Saying Hey!', version: 'Extended Mix' }
  const link = { url: 'https://open.spotify.com/track/3Ua9ViclYppEXxxNBcFymr' }
  const payload = buildPayload(target, track, 7.4, link, 'https://www.1001tracklists.com/tracklist/2q9sf971/some-set.html')

  t.same(Object.keys(payload), [
    'type', 'hasCue', 'isLive', 'idTL', 'idTLP', 'trackNo', 'isID', 'sugType',
    'suggestionvalue', 'cue', 'validLinkType', 'validLink',
  ])
  t.equal(payload.type, 'id')
  t.equal(payload.hasCue, '0')
  t.equal(payload.isLive, 0)
  t.equal(payload.idTLP, 14375750)
  t.equal(payload.trackNo, 0)
  t.equal(payload.isID, true)
  t.equal(payload.sugType, 0)
  t.equal(payload.suggestionvalue, 'Darco & DvirNuns - Saying Hey! (Extended Mix)')
  t.equal(payload.cue, 7)
  t.equal(payload.validLinkType, 10)
  t.equal(payload.validLink, 'https://open.spotify.com/track/3Ua9ViclYppEXxxNBcFymr')
  t.end()
})

test('buildPayload reads idTL from the tracklist URL', (t) => {
  const target = { type: 'add', sugType: 3, idTLP: 111, trackNo: 0, isID: true }
  const track = { artists: 'A', title: 'B', version: '' }
  const link = { url: 'https://youtu.be/abc' }
  const payload = buildPayload(target, track, 3.5, link, 'https://www.1001tracklists.com/tracklist/2q9sf971/some-set.html')
  t.equal(payload.idTL, '2q9sf971')
  t.equal(payload.cue, 4)
  t.equal(payload.validLinkType, 13)
  t.end()
})

test('saveSession backs up the old cookies file then writes the new one', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'setbrainz-savesession-'))
  t.teardown(() => rmSync(dir, { recursive: true, force: true }))

  const path = join(dir, 'cookies.txt')
  writeNetscapeCookies(path, [
    { name: 'old', value: '1', domain: '.example.com', path: '/', expires: -1, httpOnly: false, secure: false },
  ])

  const newCookies = [
    { name: 'new', value: '2', domain: '.example.com', path: '/', expires: -1, httpOnly: false, secure: false },
  ]
  saveSession(path, newCookies)

  t.ok(existsSync(`${path}.bak`))
  t.match(readFileSync(`${path}.bak`, 'utf8'), /old/)
  t.match(readFileSync(path, 'utf8'), /new/)
  t.end()
})
