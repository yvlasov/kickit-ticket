# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Copy root and workspace package files
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY shared/tsconfig.json shared/
COPY server/tsconfig.json server/
COPY web/tsconfig.json web/

RUN npm ci --ignore-scripts

# Copy source
COPY shared/ shared/
COPY server/ server/
COPY web/ web/

# Build web
WORKDIR /app/web
RUN npm run build

# Runtime stage
FROM node:22-slim

WORKDIR /app

# Copy built web dist
COPY --from=builder /app/web/dist ./web/dist

# Copy package files for runtime deps
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY shared/tsconfig.json shared/
COPY server/tsconfig.json server/
COPY server/drizzle/ server/drizzle/

RUN npm ci --ignore-scripts

# Copy server source (tsx runs from source)
COPY server/src/ server/src/

# Copy shared source (needed for @kickit/shared imports)
COPY shared/src/ shared/src/

# Copy drizzle files
COPY server/drizzle/ server/drizzle/
COPY server/drizzle.config.ts server/

EXPOSE 3000

CMD ["npx", "tsx", "server/src/index.ts"]
