# PracticalDocs & Storage Server

A document editor for long, page-accurate documents - theses and reports - built on Vue 3 and
Tiptap, with an integrated AES-256-GCM encrypted storage backend (`practicaldocs-server`).

Package: `@np_makin/practicaldocs`.

PracticalDocs is based on [Umo Editor](https://www.umodoc.com) by Umodoc, MIT licensed. The
`LICENSE` file carries that copyright and stays as it is. Everything added here - the pagination
engine, the numbering profiles, cross-references, the PDF bookmark tooling - follows the same
licence.

---

## Usage

```bash
npm install @np_makin/practicaldocs
```

Register the plugin, then use the component. **The tag is `<practical-docs>`** - Vue derives it from
the component's own name, `PracticalDocs`, so `<practicaldocs>` without the hyphen matches nothing
and renders an empty element without an error.

```js
// main.js
import { createApp } from 'vue'
import { usePracticalDocs } from '@np_makin/practicaldocs'
// The subpath, not the file: `exports` in package.json maps `./style` and blocks deep paths.
import '@np_makin/practicaldocs/style'

import App from './App.vue'

createApp(App).use(usePracticalDocs, {}).mount('#app')
```

```vue
<template>
  <practical-docs ref="editorRef" v-bind="options" />
</template>
```

`<PracticalDocs>` works too inside a single-file component. The other exports are
`PdocMenuButton`, `PdocDialog` and `PdocTooltip`.

**`pdoc-` is a CSS prefix, not the tag.** `pdoc-editor-container` and `--pdoc-primary-color` are
class and custom-property names; the component is `<practical-docs>`. They look alike and are
unrelated.

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
    # Whatever directory you deploy to; the example below is a placeholder.
    root * /var/www/practicaldocs/dist
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
- **Portable JSON Snapshots**: Export/import `.practicaldocs.json` documents with full profile state persistence.
