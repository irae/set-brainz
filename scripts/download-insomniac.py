#!/usr/bin/env python3
import hashlib, json, os, re, sys, urllib.request

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'Referer': 'https://insomniacradio.com/',
    'Accept-Language': 'en-US',
}
SHOWS = 'https://firestore.googleapis.com/v1/projects/insomniac-radio-75d6b/databases/(default)/documents/shows/'
KEY = 'REMOVED_FIREBASE_KEY'


def fetch(url, **headers):
    return urllib.request.urlopen(urllib.request.Request(url, headers={**HEADERS, **headers}), timeout=60)


def main(page_url, out):
    match = re.search(r'/shows/([^/?#]+)/episodes/([^/?#]+)', page_url)
    if not match:
        sys.exit('usage: download-insomniac.py https://insomniacradio.com/shows/<show>/episodes/<episode> <out.mp3>')
    show_id, episode_id = match.groups()
    show = json.load(fetch(f'{SHOWS}{show_id}?key={KEY}'))['fields']
    episodes = [e['mapValue']['fields'] for e in show['episodes']['arrayValue'].get('values', [])]
    episode = next((e for e in episodes if e['id']['stringValue'] == episode_id), None)
    if not episode:
        listing = '\n'.join(f"  {e['episodeNumber'].get('integerValue', '?')}  {e['id']['stringValue']}  {e['title']['stringValue'].strip()}" for e in episodes)
        sys.exit(f'episode {episode_id} is not in the show list; the site keeps only recent episodes. Episodes now listed:\n{listing}')
    sound = episode['sound']['mapValue']['fields']['url']['stringValue']
    print(f"{episode['title']['stringValue'].strip()}\n{sound}", file=sys.stderr)

    part = out + '.part'
    total, etag, failures = None, None, 0
    while True:
        have = os.path.getsize(part) if os.path.exists(part) else 0
        if total is not None and have >= total:
            break
        try:
            with fetch(sound, Range=f'bytes={have}-') as reply, open(part, 'ab') as file:
                if reply.status != 206:
                    sys.exit(f'expected 206 from {reply.url}, got {reply.status}')
                total = int(reply.headers['Content-Range'].rsplit('/', 1)[1])
                etag = reply.headers.get('ETag', '').strip('"')
                file.write(reply.read())
            failures = 0
        except OSError as error:
            failures += 1
            if failures > 5:
                sys.exit(f'request failed 6 times, last error: {error}; run again to resume from {part}')
            print(f'\nretrying after: {error}', file=sys.stderr)
        print(f'\r{have * 100 // (total or 1)}%', end='', file=sys.stderr)

    size = os.path.getsize(part)
    if size != total:
        sys.exit(f'size {size} does not match {total}')
    if re.fullmatch(r'[0-9a-f]{32}', etag or ''):
        digest = hashlib.md5(open(part, 'rb').read()).hexdigest()
        if digest != etag:
            sys.exit(f'md5 {digest} does not match etag {etag}; delete {part} and run again')
    os.replace(part, out)
    print(f'\nsaved {out} ({size} bytes)', file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('usage: download-insomniac.py <episode-url> <out.mp3>')
    main(*sys.argv[1:])
