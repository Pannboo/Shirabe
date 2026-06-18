FROM node:22-bookworm-slim AS build

WORKDIR /app

# Need build tools for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm install

COPY tsconfig.base.json ./
COPY server/ server/
COPY client/ client/

RUN npm run build -w client
RUN mkdir -p server/src/static && cp -r client/dist/* server/src/static/
RUN npm run build -w server

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    beets ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/src/static server/dist/static
# tsc only emits .ts → .js; the schema.sql sitting next to db/client.ts
# has to be copied manually so readFileSync(join(here, "schema.sql")) at
# boot resolves. Without this the container crashes on first start with
# ENOENT for schema.sql.
COPY --from=build /app/server/src/db/schema.sql server/dist/db/schema.sql
# npm workspaces hoist every dep to the root /app/node_modules — there is
# no /app/server/node_modules to copy. Node resolves from the root tree
# because /app/server is nested inside /app.
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000
WORKDIR /app/server
CMD ["node", "dist/index.js"]
