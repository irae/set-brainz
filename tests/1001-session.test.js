import { test } from 'tap'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readNetscapeCookies,
  writeNetscapeCookies,
  contextOptionsFromFingerprint,
  loadSession,
} from '../app/1001-session.js'

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

test('maps a browser fingerprint to Playwright context options', (t) => {
  const options = contextOptionsFromFingerprint({
    ua: 'Mozilla/5.0 test-agent',
    lang: 'en-US',
    langs: ['en-US', 'en', 'pt-BR'],
    viewport: [1722, 961],
    screen: [3440, 1440, 3440, 1440],
    dpr: 1,
    tz: 'America/Sao_Paulo',
    touch: 0,
    mobile: false,
  })

  t.same(options, {
    userAgent: 'Mozilla/5.0 test-agent',
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8' },
    viewport: { width: 1722, height: 961 },
    screen: { width: 3440, height: 1440 },
    deviceScaleFactor: 1,
    timezoneId: 'America/Sao_Paulo',
    hasTouch: false,
    isMobile: false,
  })
  t.end()
})

test('loadSession fails with a clear message when the cookies file is missing', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'setbrainz-session-'))
  t.teardown(() => rmSync(dir, { recursive: true, force: true }))

  const fingerprintPath = join(dir, 'browser.json')
  writeFileSync(fingerprintPath, JSON.stringify({ ua: 'x', lang: 'en-US', langs: ['en-US'], viewport: [1, 1], screen: [1, 1], dpr: 1, tz: 'UTC', touch: 0, mobile: false }))

  t.throws(
    () => loadSession(join(dir, 'missing-cookies.txt'), fingerprintPath),
    /Missing 1001Tracklists cookies file/
  )
  t.end()
})

test('loadSession fails with a clear message when the fingerprint file is missing', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'setbrainz-session-'))
  t.teardown(() => rmSync(dir, { recursive: true, force: true }))

  const cookiesPath = join(dir, 'cookies.txt')
  writeNetscapeCookies(cookiesPath, [])

  t.throws(
    () => loadSession(cookiesPath, join(dir, 'missing-browser.json')),
    /Missing browser fingerprint file/
  )
  t.end()
})

test('loadSession returns cookies and context options when both files exist', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'setbrainz-session-'))
  t.teardown(() => rmSync(dir, { recursive: true, force: true }))

  const cookiesPath = join(dir, 'cookies.txt')
  const fingerprintPath = join(dir, 'browser.json')
  writeNetscapeCookies(cookiesPath, [
    { name: 'sid', value: 'abc', domain: '.example.com', path: '/', expires: -1, httpOnly: true, secure: true },
  ])
  writeFileSync(fingerprintPath, JSON.stringify({ ua: 'x', lang: 'en-US', langs: ['en-US'], viewport: [1, 1], screen: [1, 1], dpr: 1, tz: 'UTC', touch: 0, mobile: false }))

  const session = loadSession(cookiesPath, fingerprintPath)

  t.equal(session.cookies.length, 1)
  t.equal(session.cookies[0].name, 'sid')
  t.equal(session.contextOptions.userAgent, 'x')
  t.end()
})
