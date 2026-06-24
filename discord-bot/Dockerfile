FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY client/package.json client/
COPY discord-bot/package.json discord-bot/
COPY discord-rpc/package.json discord-rpc/
RUN npm install --workspace @shirabe/discord-bot --include-workspace-root

COPY tsconfig.base.json ./
COPY discord-bot/ discord-bot/

RUN npm run build -w @shirabe/discord-bot

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/discord-bot/package.json discord-bot/
COPY --from=build /app/discord-bot/dist discord-bot/dist
COPY --from=build /app/node_modules ./node_modules

WORKDIR /app/discord-bot
CMD ["node", "dist/index.js"]
