# Tabletsgo — single-image build: builds the frontend, then runs the
# Express API which also serves the static build on the same port.
FROM node:20-bookworm-slim

# better-sqlite3 compiles native bindings on install.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (dev deps are needed to run the Vite build).
COPY package*.json ./
RUN npm install

# Build the frontend.
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
# Persist app metadata (users, connections, saved queries) outside the image.
ENV META_DB=/app/data/app.db

EXPOSE 3000
CMD ["node", "server.js"]
