import { test } from 'tap'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readNetscapeCookies, writeNetscapeCookies } from '../app/cookies.js'

test('round-trips cookies through write and read', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'setbrainz-cookies-'))
  t.teardown(() => rmSync(dir, { recursive: true, force: true }))

  const path = join(dir, 'cookies.txt')
  const cookies = [
    { name: 'sid', value: 'abc123', domain: '.example.com', path: '/', expires: 1893456000, httpOnly: true, secure: true },
    { name: 'plain', value: 'v', domain: 'www.example.com', path: '/x', expires: -1, httpOnly: false, secure: false },
  ]

  writeNetscapeCookies(path, cookies)
  const roundTripped = readNetscapeCookies(path)

  t.same(roundTripped, [
    { name: 'sid', value: 'abc123', domain: '.example.com', path: '/', expires: 1893456000, httpOnly: true, secure: true },
    { name: 'plain', value: 'v', domain: 'www.example.com', path: '/x', expires: -1, httpOnly: false, secure: false },
  ])
  t.end()
})
