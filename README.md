# Practical UmoDoc & Storage Server

A document editor application based on Vue 3 and Tiptap with an integrated AES-256-GCM encrypted storage backend (`practical-umodoc-server`).

---

## 🚀 Quick Start (Development)

### 1. Run Storage Server
```bash
npm run server
```
*Runs `practical-umodoc-server` on `http://localhost:3001`.*

### 2. Run Editor Web App
```bash
npm run dev
```
*Runs frontend development server on `http://localhost:9000`.*

---

## 📦 Deployment Guide

### Step 1: Build Frontend Assets
```bash
npm run build
```
This compiles production static assets into the `./dist/` directory.

### Step 2: Run Backend Storage Server (PM2)
Run the backend server in background using PM2:
```bash
npm install -g pm2
PORT=3001 ENCRYPTION_SECRET="your-secure-custom-key" pm2 start storage-server/server.js --name "practical-umodoc-server"
pm2 save
```

### Step 3: Configure Caddy Web Server (`Caddyfile`)
Add the following configuration to your `Caddyfile`:

```caddy
doc.yourdomain.com {
    # Serve compiled frontend static assets
    root * /var/www/practical-umodoc/dist
    file_server

    # Reverse proxy API requests to practical-umodoc-server
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

## 🔐 Key Features
- **AES-256-GCM Encrypted Storage**: Documents saved to `storage-server/data/` are encrypted at rest.
- **Save Target Selector**: Switch between `practical-umodoc-server`, `Local Storage`, and `Google Drive`.
- **Unified Block Style Profiles**: Unified Paragraph and Heading profiles with ON/OFF auto-numbering toggles.
- **Portable JSON Snapshots**: Export/import `.umodoc.json` documents with full profile state persistence.
