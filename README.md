# PracticalDocs & Storage Server

A document editor for long, page-accurate documents - theses and reports - built on Vue 3 and
Tiptap, with an integrated AES-256-GCM encrypted storage backend (`practicaldocs-server`).

Package: `@np_makin/practicaldocs`.

PracticalDocs is based on [Umo Editor](https://www.umodoc.com) by Umodoc, MIT licensed. The
`LICENSE` file carries that copyright and stays as it is. Everything added here - the pagination
engine, the numbering profiles, cross-references, the PDF bookmark tooling - follows the same
licence.

**Names that look like the old one and must stay that way.** They are identifiers written into files
and browser storage, not product names, and changing them would break documents that already exist:

- the `pdoc-` CSS prefix, which is in every saved `document.html`
- `format: "umodoc"` in every saved `settings.json`, which the reader checks before opening a file
- the `practicaldocs:` localStorage keys holding the open document and the profile list

---

## Quick Start (Development)

### 1. Run Storage Server
```bash
npm run server
```
*Runs `practicaldocs-server` on `http://localhost:3001`.*

### 2. Run Editor Web App
```bash
npm run dev
```
*Runs frontend development server on `http://localhost:9000`.*

---

## Deployment Guide

### Step 1: Build Frontend Assets
```bash
npm run build
```
This compiles production static assets into the `./dist/` directory.

### Step 2: Run Backend Storage Server (PM2)
Run the backend server in background using PM2:
```bash
npm install -g pm2
PORT=3001 ENCRYPTION_SECRET="your-secure-custom-key" pm2 start storage-server/server.js --name "practicaldocs-server"
pm2 save
```

### Step 3: Configure Caddy Web Server (`Caddyfile`)
Add the following configuration to your `Caddyfile`:

```caddy
doc.yourdomain.com {
    # Serve compiled frontend static assets
    root * /var/www/practical-umodoc/dist
    file_server

    # Reverse proxy API requests to practicaldocs-server
    handle /api/* {
        reverse_proxy 127.0.0.1:3001
    }

    # SPA fallback for frontend routes
    handle {
        try_files {path} /index.html
    }
}
```

Reload Caddy:
```bash
sudo caddy reload
```

---

## Key Features
- **AES-256-GCM Encrypted Storage**: Documents saved to `storage-server/data/` are encrypted at rest.
- **Save Target Selector**: Switch between `practicaldocs-server`, `Local Storage`, and `Google Drive`.
- **Unified Block Style Profiles**: Unified Paragraph and Heading profiles with ON/OFF auto-numbering toggles.
- **Portable JSON Snapshots**: Export/import `.umodoc.json` documents with full profile state persistence.
