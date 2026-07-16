# Contributing to Tabletsgo

Thanks for taking the time to contribute! This guide covers how to get a dev
environment running, the conventions the codebase follows, and how to submit
a change.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Getting started

### Prerequisites

- Node.js 20+
- npm
- Docker (optional, for the container workflow)

### Local development

```bash
git clone https://github.com/aidapedia/tabletsgo.git
cd tabletsgo
npm install

# Create your env (generates a required encryption key)
cp .env.example .env
node -e "console.log('CONNECTION_ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('hex'))" >> .env

# Run frontend (Vite) + backend (Express) together
npm run dev:all
```

Frontend runs on Vite's dev server; the API (`server.js`) runs on `PORT`
(default `3000`). See [`.env.example`](.env.example) for all configurable
variables (documented in `CLAUDE.md` too).

Other useful scripts:

```bash
npm run dev        # frontend only
npm run server     # backend only
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

### Docker

```bash
docker compose up -d
```

Builds the single-image deploy (frontend static + API on one origin). Useful
for verifying a change end-to-end the way it'll actually ship.

---

## Project structure

Tabletsgo is a feature-sliced React + TypeScript app. Before adding files,
read the **PROJECT STRUCTURE** section in [`CLAUDE.md`](CLAUDE.md) — it's the
source of truth for where things live (`app/`, `shared/`, `features/*`,
`pages/*`) and the conventions each layer follows (barrel exports, import
direction, shared UI components to reuse instead of re-styling inline).

Keep that map in `CLAUDE.md` in sync whenever you add, remove, or rename a
top-level folder.

---

## Development standards

- Prioritize simplicity and readability over clever solutions.
- Start with minimal functionality and verify it works before adding
  complexity — test with realistic inputs, not just the happy path.
- Use functional, stateless approaches where they improve clarity; keep core
  logic clean and push implementation details to the edges.
- Match the existing style (indentation, naming, patterns) rather than
  introducing a new one in the file you're touching.
- Don't add abstractions, config options, or error handling for scenarios
  that can't happen — three similar lines beat a premature abstraction.
- All backend calls from the frontend go through `shared/api/request.ts`
  (`request()` for mutations, `safeRequest()` for reads that should degrade
  quietly) — never call `fetch` directly.
- Reuse `shared/ui` components (`Button`, `Input`, `Avatar`, `Badge`,
  `ConfirmDialog`, etc.) instead of re-styling inline. Full conventions are in
  `CLAUDE.md`.

### Database-agnostic contracts

Tabletsgo's roadmap covers SQLite, PostgreSQL, and eventually MySQL/MariaDB.
Any new API contract (request/response shape, connection field, etc.) must be
written generically enough to work across database types — don't bake in
assumptions specific to one dialect.

### Adding a backend endpoint

Every new server endpoint must be documented in
[`BACKEND_DOCUMENTATION.MD`](BACKEND_DOCUMENTATION.MD) with its request,
response, and a sample URL, following the existing entries' format.

---

## Versioning

`package.json`'s version follows this project's own scheme, not strict semver
intent:

- **Minor** bump — any change to the data contract between frontend and
  server (new/changed fields, endpoints, request/response shapes).
- **Patch** bump — frontend-only changes.
- **Major** bump — only on explicit user/maintainer request.

Bump the version as part of the same PR that makes the change.

---

## Commit & PR workflow

1. Fork the repo and create a branch off `v0.x.x` (the main branch).
2. Make your change, following the standards above.
3. Run `npm run typecheck` and exercise the affected feature locally
   (`npm run dev:all` or `docker compose up -d`) before opening a PR.
4. Update `CLAUDE.md` / `BACKEND_DOCUMENTATION.MD` if your change affects
   project structure or the API contract.
5. Open a PR against `v0.x.x` with a clear description of the *why*, not just
   the *what*.
6. Keep PRs focused — one feature/fix per PR is easier to review than a
   bundle of unrelated changes.

### Commit messages

Keep them short and descriptive of intent (see `git log` for examples), e.g.:

```
feat: setting timeout and direct commit
fix: subdirectory saved queries path resolution
```

---

## Reporting bugs & requesting features

Please use GitHub Issues. Include:

- What you expected vs. what happened.
- Steps to reproduce (connection type — SQLite/PostgreSQL — matters).
- Relevant logs or screenshots.

For security-sensitive issues, please email
kurniaji.gunawan.dev@gmail.com instead of opening a public issue.

---

## Questions

Open a GitHub Discussion or Issue — happy to help you get oriented.
