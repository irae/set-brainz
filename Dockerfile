FROM node:24-bookworm-slim

COPY --from=ghcr.io/astral-sh/uv:0 /uv /usr/local/bin/uv

# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg git python3 \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
 && chmod 755 /usr/local/bin/yt-dlp

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev

COPY --chown=node:node scripts ./scripts
RUN scripts/install-ripthatset.sh && scripts/install-tracklistify.sh \
 && rm -rf tools/*/.git

COPY --chown=node:node app ./app

ENV SETBRAINZ_DATA_DIR=/data \
    SETBRAINZ_HOST=0.0.0.0 \
    SETBRAINZ_PORT=8765
EXPOSE 8765
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.SETBRAINZ_PORT+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "app/server.js"]
