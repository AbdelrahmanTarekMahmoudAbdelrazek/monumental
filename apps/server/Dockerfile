# Socket server image (monorepo-aware). Build context = repo root:
#   docker build -f apps/server/Dockerfile -t monumental-server .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @monumental/db generate && pnpm --filter @monumental/server build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/server/package.json apps/server/
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/apps/server/dist apps/server/dist
EXPOSE 4000
HEALTHCHECK CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "apps/server/dist/index.js"]
