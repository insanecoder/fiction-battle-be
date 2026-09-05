FROM node:20-alpine AS base
WORKDIR /app

# --- deps: full install, needed to run tsc during build ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci 

# --- build: compile TypeScript -> dist/ ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# --- prod-deps: separate install, omit=dev from the start (no build tools
# ever touch this layer, no need to install-then-prune) ---
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime ---
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# data-seed.json is read at runtime by path.join("src", "data-seed.json"), not
# compiled by tsc, so it's copied separately if you run the seed script here.
COPY src/data-seed.json ./src/data-seed.json

# Secrets (MONGO_URI, FIREBASE_*, etc.) are never baked into the image — inject
# them at `docker run`/compose/orchestrator level (--env-file, -e, secrets manager).

USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
