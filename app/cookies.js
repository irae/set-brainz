import { readFileSync, writeFileSync } from 'node:fs';

export function readNetscapeCookies(path) {
  const text = readFileSync(path, 'utf8');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw = trimmed;
    let httpOnly = false;
    if (raw.startsWith('#HttpOnly_')) {
      httpOnly = true;
      raw = raw.slice('#HttpOnly_'.length);
    } else if (raw.startsWith('#')) {
      continue;
    }
    const parts = raw.split('\t');
    if (parts.length < 7) continue;
    const [domain, , cpath, secure, expires, name, ...valueParts] = parts;
    out.push({
      name,
      value: valueParts.join('\t'),
      domain,
      path: cpath || '/',
      expires: Number(expires) || -1,
      httpOnly,
      secure: String(secure).toUpperCase() === 'TRUE',
    });
  }
  return out;
}

export function writeNetscapeCookies(path, cookies) {
  const lines = [
    '# Netscape HTTP Cookie File',
    '# https://curl.se/docs/http-cookies.html',
    '# This is a generated file! Do not edit.',
    '',
  ];
  for (const c of cookies) {
    const flag = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expires = c.expires && c.expires > 0 ? Math.round(c.expires) : 0;
    const prefix = c.httpOnly ? '#HttpOnly_' : '';
    lines.push(
      `${prefix}${c.domain}\t${flag}\t${c.path || '/'}\t${secure}\t${expires}\t${c.name}\t${c.value}`
    );
  }
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}
