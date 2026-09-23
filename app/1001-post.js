import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { loadSession, saveSession } from './1001-session.js';

export function suggestionText(track) {
  const artists = track.artists.trim();
  const title = track.title.trim();
  const version = (track.version || '').trim();
  const base = `${artists} - ${title}`;
  return version ? `${base} (${version})` : base;
}

export function linkType(url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') {
    return 13;
  }
  if (host === 'open.spotify.com' || host === 'music.apple.com') {
    return 10;
  }
  throw Object.assign(new Error(`unsupported_link: ${host}`), { code: 'unsupported_link' });
}

export function findPendingSuggestion(siteRows, idTLP, user) {
  const row = siteRows.find((r) => r.idTLP === idTLP);
  if (!row || !row.suggestions) return null;
  return row.suggestions.find((s) => s.user === user) || null;
}

export function chooseTarget(siteRows, trackNo) {
  const existing = siteRows.find((row) => row.trackNo === trackNo);
  if (existing) {
    if (existing.state === 'track') {
      throw Object.assign(
        new Error(`site row ${trackNo} already holds ${existing.title}`),
        { code: 'row_taken' }
      );
    }
    return { type: 'id', sugType: 0, idTLP: existing.idTLP, trackNo: existing.trackNo, isID: true };
  }
  if (trackNo === siteRows.length) {
    const last = siteRows[siteRows.length - 1];
    return { type: 'add', sugType: 3, idTLP: last.idTLP, trackNo: last.trackNo, isID: true };
  }
  throw Object.assign(
    new Error(`position_gap: trackNo ${trackNo} is beyond the site's ${siteRows.length} rows`),
    { code: 'position_gap' }
  );
}

export function buildPayload(target, track, cueSeconds, link, tracklistUrl) {
  const idTL = tracklistUrl.split('/tracklist/')[1].split('/')[0];
  return {
    type: target.type,
    hasCue: '0',
    isLive: 0,
    idTL,
    idTLP: target.idTLP,
    trackNo: target.trackNo,
    isID: target.isID,
    sugType: target.sugType,
    suggestionvalue: suggestionText(track),
    cue: Math.round(cueSeconds),
    validLinkType: linkType(link.url),
    validLink: link.url,
  };
}

export async function postRow({ tracklistUrl, track, cueSeconds, trackNo, link, paths, log }) {
  const session = loadSession(paths.cookies, paths.fingerprint);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(session.contextOptions);
    await context.addCookies(session.cookies);
    const page = await context.newPage();
    log({ event: 'open', tracklistUrl });

    await page.goto(tracklistUrl, { waitUntil: 'domcontentloaded' });
    mkdirSync(paths.screenshotDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await page.screenshot({ path: `${paths.screenshotDir}/${stamp}-${trackNo}-page.png` });

    try {
      await page.waitForSelector('div.tlpTog[data-trno]', { timeout: 20000 });
    } catch {
      const html = await page.content();
      writeFileSync(`${paths.screenshotDir}/${stamp}-${trackNo}-page.html`, html, 'utf8');
      throw Object.assign(
        new Error('no track rows on the page after 20 seconds, see the saved html'),
        { code: 'no_site_rows' }
      );
    }

    const signedIn = await page
      .locator('[title="sign out" i], [aria-label="sign out" i], a[href*="/dashboard/"]')
      .count();
    if (signedIn === 0) {
      throw Object.assign(new Error('not_logged_in'), { code: 'not_logged_in' });
    }
    const bodyText = await page.textContent('body');
    const title = await page.title();
    if (/just a moment|attention required/i.test(title) || /cf-challenge|verify you are human/i.test(bodyText)) {
      throw Object.assign(new Error('challenge_page'), { code: 'challenge_page' });
    }
    log({ event: 'login' });

    const rowsByTrackNo = await page.$$eval('div.tlpTog[data-trno]', (rows) =>
      rows.map((row) => {
        const titleEl = row.querySelector('.trackValue');
        const title = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : '';
        return {
          trackNo: Number(row.getAttribute('data-trno')),
          idTLP: Number(row.id.split('tlp_')[1]),
          title,
          state: title === 'ID - ID' ? 'id' : 'track',
        };
      })
    );
    if (rowsByTrackNo.length === 0) {
      throw Object.assign(new Error('no_site_rows'), { code: 'no_site_rows' });
    }
    const suggestionsByTLP = await page.$$eval('.sugTog[data-tlp]', (nodes) =>
      nodes.reduce((map, node) => {
        const idTLP = Number(node.getAttribute('data-tlp'));
        const valueEl = node.querySelector('[id$="_value"] .blueTxt');
        const text = valueEl ? (valueEl.childNodes[0] ? valueEl.childNodes[0].textContent.trim() : '') : '';
        const userSpan = [...node.querySelectorAll('.wRow span')].find((s) => !s.className);
        const user = userSpan ? userSpan.textContent.trim() : '';
        (map[idTLP] || (map[idTLP] = [])).push({ text, user });
        return map;
      }, {})
    );
    const siteRows = rowsByTrackNo.map((row) => ({
      ...row,
      suggestions: suggestionsByTLP[row.idTLP] || [],
    }));
    log({ event: 'siteRows', siteRows });

    const user = await page.$eval('a[href*="/dashboard/"]', (a) => {
      const m = /user dashboard for ([^\s(]+)/i.exec(a.getAttribute('title') || '');
      return m ? m[1] : null;
    });
    log({ event: 'user', user });
    if (user === null) {
      throw Object.assign(
        new Error('could not read the user name from the page'),
        { code: 'not_logged_in' }
      );
    }

    const target = chooseTarget(siteRows, trackNo);
    log({ event: 'target', target });

    const mine = findPendingSuggestion(siteRows, target.idTLP, user);
    if (mine) {
      throw Object.assign(
        new Error(`already_suggested: ${mine.text}`),
        { code: 'already_suggested' }
      );
    }
    const targetRow = siteRows.find((r) => r.idTLP === target.idTLP);
    const others = (targetRow ? targetRow.suggestions : []).filter((s) => s.user !== user);
    if (others.length) {
      log({ event: 'otherSuggestion', suggestions: others });
    }

    const payload = buildPayload(target, track, cueSeconds, link, tracklistUrl);
    log({ event: 'payload', payload });

    const response = await page.evaluate(
      async (body) => {
        const res = await fetch('/ajax/add_suggestion.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body,
          credentials: 'include',
        });
        return { status: res.status, text: await res.text() };
      },
      new URLSearchParams(payload).toString()
    );
    await page.screenshot({ path: `${paths.screenshotDir}/${stamp}-${trackNo}-response.png` });
    log({ event: 'response', response });

    let json;
    try {
      json = JSON.parse(response.text);
    } catch {
      json = null;
    }
    if (!json || response.status !== 200) {
      throw Object.assign(new Error(`bad_response: ${response.text.slice(0, 500)}`), { code: 'bad_response' });
    }
    if (json.success !== true) {
      throw Object.assign(new Error(`site_rejected: ${json.message}`), { code: 'site_rejected' });
    }

    const cookies = await context.cookies();
    saveSession(paths.cookies, cookies);
    log({ event: 'cookiesSaved' });

    return {
      suggestionId: String(json.idSug),
      siteRowId: target.idTLP,
      trackNo: target.trackNo,
      payload,
      response: json,
    };
  } catch (error) {
    log({ event: 'error', message: error.message, code: error.code });
    throw error;
  } finally {
    await browser.close();
  }
}
