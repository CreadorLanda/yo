# Build from the repository root: the bots use the SDK source in sdk/typescript.
FROM oven/bun:1.3-alpine
WORKDIR /app
COPY sdk/typescript/package.json sdk/typescript/bun.lock sdk/typescript/
RUN cd sdk/typescript && bun install --frozen-lockfile --production
COPY sdk/typescript/src sdk/typescript/src
COPY official-bots/package.json official-bots/bun.lock official-bots/tsconfig.json official-bots/
RUN cd official-bots && bun install --frozen-lockfile --production
COPY official-bots/src official-bots/src
WORKDIR /app/official-bots
ENV DATA_DIR=/data
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
USER bun
CMD ["bun", "src/reminders/main.ts"]
