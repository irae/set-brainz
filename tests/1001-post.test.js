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
  findPendingSuggestion,
  findTimeConflict,
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

test('linkType maps a Beatport host to 10, with or without www', (t) => {
  t.equal(linkType('https://www.beatport.com/track/x/1'), 10)
  t.equal(linkType('https://beatport.com/track/x/1'), 10)
  t.end()
})

test('linkType maps a SoundCloud host to 10, with or without www', (t) => {
  t.equal(linkType('https://soundcloud.com/x/y'), 10)
  t.equal(linkType('https://www.soundcloud.com/x/y'), 10)
  t.end()
})

test('linkType maps a TikTok host to 10, with or without www or m', (t) => {
  t.equal(linkType('https://www.tiktok.com/@x/video/1'), 10)
  t.equal(linkType('https://tiktok.com/@x/video/1'), 10)
  t.equal(linkType('https://m.tiktok.com/@x/video/1'), 10)
  t.end()
})

test('linkType maps any other host to 255', (t) => {
  t.equal(linkType('https://example.com/track'), 255)
  t.end()
})

test('chooseTarget returns an id target when the row already exists as an ID', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, state: 'id', title: 'ID - ID' },
    { idTLP: 222, trackNo: 1, state: 'id', title: 'ID - ID' },
  ]
  const target = chooseTarget(siteRows, 1)
  t.same(target, { type: 'id', sugType: 0, idTLP: 222, trackNo: 1, isID: true })
  t.end()
})

test('chooseTarget returns an add target for the row right after the last', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, state: 'id', title: 'ID - ID' },
    { idTLP: 222, trackNo: 1, state: 'id', title: 'ID - ID' },
  ]
  const target = chooseTarget(siteRows, 2)
  t.same(target, { type: 'add', sugType: 3, idTLP: 222, trackNo: 1, isID: true })
  t.end()
})

test('chooseTarget returns the add target on the last site row when trackNo equals the row count', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, state: 'id', title: 'ID - ID' },
    { idTLP: 222, trackNo: 1, state: 'track', title: 'A - B' },
  ]
  const target = chooseTarget(siteRows, 2)
  t.same(target, { type: 'add', sugType: 3, idTLP: 222, trackNo: 1, isID: false })
  t.end()
})

test('chooseTarget returns the add target on the last site row when trackNo is far ahead', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, state: 'id', title: 'ID - ID' },
    { idTLP: 222, trackNo: 1, state: 'id', title: 'ID - ID' },
  ]
  const target = chooseTarget(siteRows, 5)
  t.same(target, { type: 'add', sugType: 3, idTLP: 222, trackNo: 1, isID: true })
  t.end()
})

test('chooseTarget throws row_taken when the row already holds a named track', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, state: 'track', title: 'Darco & DvirNuns - Saying Hey!' },
    { idTLP: 222, trackNo: 1, state: 'id', title: 'ID - ID' },
  ]
  try {
    chooseTarget(siteRows, 0)
    t.fail('should have thrown')
  } catch (err) {
    t.equal(err.code, 'row_taken')
    t.match(err.message, /site row 0 already holds Darco & DvirNuns - Saying Hey!/)
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

test('buildPayload for a named ID remix row with no link sends the normal text and no link keys', (t) => {
  const target = { type: 'id', sugType: 0, idTLP: 14375750, trackNo: 0, isID: true }
  const track = { artists: 'ID', title: 'Satisfaction (ID Remix)', version: '' }
  const payload = buildPayload(target, track, 7.4, undefined, 'https://www.1001tracklists.com/tracklist/2q9sf971/some-set.html')

  t.equal(payload.suggestionvalue, 'ID - Satisfaction (ID Remix)')
  t.notOk('validLinkType' in payload)
  t.notOk('validLink' in payload)
  t.end()
})

test('chooseTarget returns a wrong-cue target when the row is an ID and ours is an ID too', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, state: 'id', title: 'ID - ID' },
  ]
  const target = chooseTarget(siteRows, 0, true)
  t.same(target, { type: 'wrong', sugType: 14, idTLP: 111, trackNo: 0, isID: true })
  t.end()
})

test('buildPayload for an ID row on an existing ID site row sends the cue-fix keys in order, no link, no suggestionvalue', (t) => {
  const target = { type: 'wrong', sugType: 14, idTLP: 14375750, trackNo: 0, isID: true }
  const track = { isId: true, artists: '', title: '', version: '' }
  const payload = buildPayload(target, track, 7.4, undefined, 'https://www.1001tracklists.com/tracklist/2q9sf971/some-set.html')

  t.same(Object.keys(payload), [
    'type', 'hasCue', 'isLive', 'idTL', 'idTLP', 'trackNo', 'isID', 'sugType', 'cue',
  ])
  t.equal(payload.type, 'wrong')
  t.equal(payload.sugType, 14)
  t.equal(payload.cue, 7)
  t.end()
})

test('buildPayload for an ID row added right after the last site row sends "ID - ID" and no link', (t) => {
  const target = { type: 'add', sugType: 3, idTLP: 14375758, trackNo: 8, isID: true }
  const track = { isId: true, artists: '', title: '', version: '' }
  const payload = buildPayload(target, track, 985.4, undefined, 'https://www.1001tracklists.com/tracklist/2q9sf971/some-set.html')

  t.same(Object.keys(payload), [
    'type', 'hasCue', 'isLive', 'idTL', 'idTLP', 'trackNo', 'isID', 'sugType', 'suggestionvalue', 'cue',
  ])
  t.equal(payload.suggestionvalue, 'ID - ID')
  t.equal(payload.cue, 985)
  t.end()
})

test('findTimeConflict returns null when no site row and no suggestion holds a cue', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, title: 'ID - ID', state: 'id', cue: null, suggestions: [] },
    { idTLP: 222, trackNo: 1, title: 'ID - ID', state: 'id', cue: null, suggestions: [{ text: 'A - B', user: 'x', cue: null }] },
  ]
  const target = { idTLP: 222, trackNo: 1 }
  t.equal(findTimeConflict(siteRows, target, 360), null)
  t.end()
})

test('findTimeConflict flags a pending suggestion 15 seconds away on another row', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, title: 'ID - ID', state: 'id', cue: null, suggestions: [{ text: 'A - B', user: 'x', cue: 375 }] },
    { idTLP: 222, trackNo: 1, title: 'ID - ID', state: 'id', cue: null, suggestions: [] },
  ]
  const target = { idTLP: 222, trackNo: 1 }
  const conflict = findTimeConflict(siteRows, target, 360)
  t.ok(conflict)
  t.match(conflict.message, /site row 1/)
  t.match(conflict.message, /Matching tracks by time is not built yet\.$/)
  t.end()
})

test('findTimeConflict ignores a pending suggestion from the logged-in user', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, title: 'ID - ID', state: 'id', cue: null, suggestions: [{ text: 'A - B', user: 'telusmcneely', cue: 375 }] },
    { idTLP: 222, trackNo: 1, title: 'ID - ID', state: 'id', cue: null, suggestions: [] },
  ]
  const target = { idTLP: 222, trackNo: 1 }
  t.equal(findTimeConflict(siteRows, target, 360, 'telusmcneely'), null)
  t.end()
})

test('findTimeConflict does not flag a pending suggestion 25 seconds away on another row', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, title: 'ID - ID', state: 'id', cue: null, suggestions: [{ text: 'A - B', user: 'x', cue: 385 }] },
    { idTLP: 222, trackNo: 1, title: 'ID - ID', state: 'id', cue: null, suggestions: [] },
  ]
  const target = { idTLP: 222, trackNo: 1 }
  t.equal(findTimeConflict(siteRows, target, 360), null)
  t.end()
})

test('findTimeConflict does not flag a cue on the target row itself within 20 seconds', (t) => {
  const siteRows = [
    { idTLP: 222, trackNo: 1, title: 'ID - ID', state: 'id', cue: 365, suggestions: [] },
  ]
  const target = { idTLP: 222, trackNo: 1 }
  t.equal(findTimeConflict(siteRows, target, 360), null)
  t.end()
})

test('findTimeConflict flags an official cue on the target row that is 40 seconds away', (t) => {
  const siteRows = [
    { idTLP: 222, trackNo: 1, title: 'Some Track', state: 'track', cue: 400, suggestions: [] },
  ]
  const target = { idTLP: 222, trackNo: 1 }
  const conflict = findTimeConflict(siteRows, target, 360)
  t.ok(conflict)
  t.match(conflict.message, /site row 2/)
  t.match(conflict.message, /Some Track/)
  t.end()
})

test('findPendingSuggestion returns the logged-in user\'s pending suggestion on the target row for type id', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, suggestions: [{ text: 'A - B', user: 'telusmcneely', cue: 7 }] },
    { idTLP: 222, trackNo: 1, suggestions: [] },
  ]
  const target = { type: 'id', idTLP: 111, trackNo: 0 }
  const found = findPendingSuggestion(siteRows, target, 'telusmcneely', 7)
  t.same(found, { text: 'A - B', user: 'telusmcneely', cue: 7 })
  t.end()
})

test('findPendingSuggestion returns null when no row holds a suggestion from that user near our cue', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, suggestions: [{ text: 'A - B', user: 'someoneElse', cue: 7 }] },
  ]
  const target = { type: 'id', idTLP: 111, trackNo: 0 }
  t.equal(findPendingSuggestion(siteRows, target, 'telusmcneely', 7), null)
  t.end()
})

test('findPendingSuggestion returns null when no site row has any suggestions', (t) => {
  const siteRows = [{ idTLP: 111, trackNo: 0, suggestions: [] }]
  const target = { type: 'id', idTLP: 111, trackNo: 0 }
  t.equal(findPendingSuggestion(siteRows, target, 'telusmcneely', 7), null)
  t.end()
})

test('an id row with a pending suggestion by another user does not block chooseTarget or findPendingSuggestion', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, state: 'id', title: 'ID - ID', suggestions: [{ text: 'A - B', user: 'someoneElse', cue: 7 }] },
  ]
  const target = chooseTarget(siteRows, 0)
  t.same(target, { type: 'id', sugType: 0, idTLP: 111, trackNo: 0, isID: true })
  t.equal(findPendingSuggestion(siteRows, target, 'telusmcneely', 7), null)
  t.end()
})

test('findPendingSuggestion returns null when the target row is not on the site and no cue is close', (t) => {
  const siteRows = [{ idTLP: 111, trackNo: 0, suggestions: [] }]
  const target = { type: 'id', idTLP: 999, trackNo: 3 }
  t.equal(findPendingSuggestion(siteRows, target, 'telusmcneely', 100), null)
  t.end()
})

test('the guard blocks an own suggestion 10 seconds away on another site row', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, state: 'id', suggestions: [{ text: 'A - B', user: 'telusmcneely', cue: 350 }] },
    { idTLP: 222, trackNo: 1, state: 'id', suggestions: [] },
  ]
  const target = { type: 'add', idTLP: 222, trackNo: 1 }
  const mine = findPendingSuggestion(siteRows, target, 'telusmcneely', 360)
  t.same(mine, { text: 'A - B', user: 'telusmcneely', cue: 350 })
  t.end()
})

test('the guard does not block an own suggestion on the anchor row 300 seconds away for an add', (t) => {
  const siteRows = [
    { idTLP: 222, trackNo: 1, state: 'id', suggestions: [{ text: 'A - B', user: 'telusmcneely', cue: 60 }] },
  ]
  const target = { type: 'add', idTLP: 222, trackNo: 1 }
  t.equal(findPendingSuggestion(siteRows, target, 'telusmcneely', 360), null)
  t.end()
})

test('the guard still blocks an own suggestion on the target row for type id, whatever its cue', (t) => {
  const siteRows = [
    { idTLP: 222, trackNo: 1, state: 'id', suggestions: [{ text: 'A - B', user: 'telusmcneely', cue: 60 }] },
  ]
  const target = { type: 'id', idTLP: 222, trackNo: 1 }
  const mine = findPendingSuggestion(siteRows, target, 'telusmcneely', 360)
  t.same(mine, { text: 'A - B', user: 'telusmcneely', cue: 60 })
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

test('findTimeConflict counts the last site row when the target adds a row after it', (t) => {
  const siteRows = [
    { idTLP: 111, trackNo: 0, title: 'ID - ID', state: 'id', cue: null, suggestions: [{ text: 'A - B', user: 'x', cue: 1000 }] },
  ]
  const target = { type: 'add', idTLP: 111, trackNo: 0 }
  t.ok(findTimeConflict(siteRows, target, 1010))
  t.equal(findTimeConflict(siteRows, target, 1100), null)
  t.end()
})
