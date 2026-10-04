FROM node:24.11.1-bookworm-slim AS build
WORKDIR /app/source
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:24.11.1-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates ffmpeg git gosu poppler-utils python3 python3-venv tini \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/python && /opt/python/bin/pip install --no-cache-dir pypdf uv
WORKDIR /app
COPY --from=build /app/source/.next/standalone ./
COPY --from=build /app/source/.next/static ./.next/static
COPY --from=build /app/source/public ./public
COPY --from=build /app/source/guide ./guide
COPY --from=build /app/source/skills ./skills
COPY --from=build /app/source/seed-skills ./seed-skills
COPY --from=build /app/source/database/migrations ./database/migrations
COPY --from=build /app/source/node_modules/@playwright/cli /opt/thursday-tools/node_modules/@playwright/cli
COPY --from=build /app/source/node_modules/playwright /opt/thursday-tools/node_modules/playwright
COPY --from=build /app/source/node_modules/playwright-core /opt/thursday-tools/node_modules/playwright-core
RUN mkdir -p /opt/thursday-tools/node_modules/.bin \
    && ln -s ../@playwright/cli/playwright-cli.js /opt/thursday-tools/node_modules/.bin/playwright-cli
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN node /opt/thursday-tools/node_modules/playwright/cli.js install --with-deps chromium
COPY hosting ./hosting
RUN chmod +x /app/hosting/docker-entrypoint.sh \
    && mkdir -p /app/.next/cache && chown -R node:node /app/.next/cache
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    THURSDAY_HOSTED=1 \
    THURSDAY_APP_DIR=/app \
    THURSDAY_HOME=/app/data \
    THURSDAY_TOOL_PATH=/opt/thursday-tools/node_modules/.bin \
    HOME=/app/data \
    XDG_CONFIG_HOME=/app/data/.config \
    XDG_CACHE_HOME=/app/data/.cache \
    PATH=/opt/python/bin:/opt/thursday-tools/node_modules/.bin:/usr/local/bin:/usr/bin:/bin
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/app/hosting/docker-entrypoint.sh"]
CMD ["node", "/app/hosting/start.mjs"]
