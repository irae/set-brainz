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

export function chooseTarget(siteRows, trackNo) {
  const existing = siteRows.find((row) => row.trackNo === trackNo);
  if (existing) {
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
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await page.screenshot({ path: `${paths.screenshotDir}/${stamp}-${trackNo}-page.png` });

    const signedIn = await page.locator('a:has-text("sign out")').count();
    if (signedIn === 0) {
      throw Object.assign(new Error('not_logged_in'), { code: 'not_logged_in' });
    }
    const bodyText = await page.textContent('body');
    const title = await page.title();
    if (/just a moment|challenge|attention required/i.test(`${title} ${bodyText}`)) {
      throw Object.assign(new Error('challenge_page'), { code: 'challenge_page' });
    }
    log({ event: 'login' });

    const siteRows = await page.$$eval('tr[data-trno]', (rows) =>
      rows.map((row) => ({
        trackNo: Number(row.getAttribute('data-trno')),
        idTLP: Number(row.id.split('tlp_')[1]),
      }))
    );
    if (siteRows.length === 0) {
      throw Object.assign(new Error('no_site_rows'), { code: 'no_site_rows' });
    }
    log({ event: 'siteRows', siteRows });

    const target = chooseTarget(siteRows, trackNo);
    log({ event: 'target', target });

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
