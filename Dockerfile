# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/asobiba

FROM base AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY --from=douga package.json package-lock.json /workspace/douga/
COPY --from=douga packages /workspace/douga/packages
RUN cd /workspace/douga && npm ci --omit=dev --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 VITE_PROVISIONED_ACCOUNTS_ONLY=1
RUN npm ci && npm run build

FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg && rm -rf /var/lib/apt/lists/*
ENV REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
COPY --from=build --chown=node:node /workspace/asobiba /workspace/asobiba
COPY --from=build --chown=node:node /workspace/douga /workspace/douga
RUN install -d -o node -g node storage
ENV NODE_ENV=production PROVISIONED_ACCOUNTS_ONLY=1
ENV HOST=0.0.0.0 ASOBIBA_STORAGE_DIR=/workspace/asobiba/storage
USER node
EXPOSE 8787
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=12 CMD ["node", "-e", "fetch('http://127.0.0.1:8787/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["npm", "start"]
