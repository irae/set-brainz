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
  const host = new URL(url).hostname.replace(/^(www\.|m\.)/, '');
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') {
    return 13;
  }
  if (
    host === 'open.spotify.com' ||
    host === 'music.apple.com' ||
    host === 'beatport.com' ||
    host === 'soundcloud.com' ||
    host === 'tiktok.com'
  ) {
    return 10;
  }
  return 255;
}

export function findPendingSuggestion(siteRows, target, user, cueSeconds) {
  if (target.type === 'id' || target.type === 'wrong') {
    const targetRow = siteRows.find((r) => r.idTLP === target.idTLP);
    const onTargetRow = targetRow && (targetRow.suggestions || []).find((s) => s.user === user);
    if (onTargetRow) return onTargetRow;
  }
  for (const row of siteRows) {
    for (const s of row.suggestions || []) {
      if (s.user !== user) continue;
      if (s.cue !== null && s.cue !== undefined && Math.abs(s.cue - cueSeconds) <= 20) {
        return s;
      }
    }
  }
  return null;
}

export function chooseTarget(siteRows, trackNo, isIdTrack = false) {
  const existing = siteRows.find((row) => row.trackNo === trackNo);
  if (existing) {
    if (existing.state === 'track') {
      throw Object.assign(
        new Error(`site row ${trackNo} already holds ${existing.title}`),
        { code: 'row_taken' }
      );
    }
    if (isIdTrack) {
      return { type: 'wrong', sugType: 14, idTLP: existing.idTLP, trackNo: existing.trackNo, isID: true };
    }
    return { type: 'id', sugType: 0, idTLP: existing.idTLP, trackNo: existing.trackNo, isID: true };
  }
  const last = siteRows[siteRows.length - 1];
  return { type: 'add', sugType: 3, idTLP: last.idTLP, trackNo: last.trackNo, isID: last.state === 'id' };
}

export function buildPayload(target, track, cueSeconds, link, tracklistUrl) {
  const idTL = tracklistUrl.split('/tracklist/')[1].split('/')[0];
  const cue = Math.round(cueSeconds);
  const base = {
    type: target.type,
    hasCue: '0',
    isLive: 0,
    idTL,
    idTLP: target.idTLP,
    trackNo: target.trackNo,
    isID: target.isID,
    sugType: target.sugType,
  };
  if (target.type === 'wrong') {
    return { ...base, cue };
  }
  const payload = { ...base, suggestionvalue: track.isId ? 'ID - ID' : suggestionText(track), cue };
  if (!track.isId) {
    payload.validLinkType = linkType(link.url);
    payload.validLink = link.url;
  }
  return payload;
}

function cueLabel(row) {
  return row.state === 'id' ? 'ID' : row.title;
}

function formatCue(seconds) {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function conflictMessage(row, cue, cueSeconds) {
  return `site row ${row.trackNo + 1} (${cueLabel(row)}) holds cue ${formatCue(cue)}, ours is ${formatCue(cueSeconds)}. Matching tracks by time is not built yet.`;
}

export function findTimeConflict(siteRows, target, cueSeconds, user) {
  const targetRow = target.type === 'add' ? null : siteRows.find((row) => row.idTLP === target.idTLP);
  if (targetRow && targetRow.cue !== null && targetRow.cue !== undefined) {
    if (Math.abs(targetRow.cue - cueSeconds) > 20) {
      return { message: conflictMessage(targetRow, targetRow.cue, cueSeconds) };
    }
  }
  for (const row of siteRows) {
    if (row === targetRow) continue;
    const suggestionCues = (row.suggestions || [])
      .filter((s) => s.user !== user)
      .map((s) => s.cue);
    const cues = [row.cue, ...suggestionCues].filter((c) => c !== null && c !== undefined);
    for (const cue of cues) {
      if (Math.abs(cue - cueSeconds) <= 20) {
        return { message: conflictMessage(row, cue, cueSeconds) };
      }
    }
  }
  return null;
}

export async function postRow({ tracklistUrl, track, cueSeconds, trackNo, link, paths, log }) {
  if (!track.isId && !link) {
    throw Object.assign(new Error('missing_link'), { code: 'missing_link' });
  }
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

    const bodyText = await page.textContent('body');
    const title = await page.title();
    if (/just a moment|attention required/i.test(title) || /cf-challenge|verify you are human|real human/i.test(bodyText)) {
      throw Object.assign(new Error('challenge_page'), { code: 'challenge_page' });
    }

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
    log({ event: 'login' });

    const rowsByTrackNo = await page.$$eval('div.tlpTog[data-trno]', (rows) =>
      rows.map((row) => {
        const titleEl = row.querySelector('.trackValue');
        const title = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : '';
        const idTLP = Number(row.id.split('tlp_')[1]);
        const cueInput = row.querySelector(`#tlp${idTLP}_cue_seconds`);
        const cueValue = cueInput ? Number(cueInput.value) : null;
        return {
          trackNo: Number(row.getAttribute('data-trno')),
          idTLP,
          title,
          state: title === 'ID - ID' ? 'id' : 'track',
          cue: cueValue ? cueValue : null,
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
        const playEl = node.querySelector('[id^="tlp_play_sug_"]');
        const onclick = playEl ? playEl.getAttribute('onclick') || '' : '';
        const cueMatch = /cue:\s*'(\d+)'/.exec(onclick);
        const cue = cueMatch ? Number(cueMatch[1]) : null;
        (map[idTLP] || (map[idTLP] = [])).push({ text, user, cue });
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

    const target = chooseTarget(siteRows, trackNo, track.isId);
    log({ event: 'target', target });

    const mine = findPendingSuggestion(siteRows, target, user, cueSeconds);
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

    const conflict = findTimeConflict(siteRows, target, cueSeconds, user);
    log({ event: 'timeCheck', conflict });
    if (conflict) {
      throw Object.assign(new Error(conflict.message), { code: 'track_mismatch' });
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
