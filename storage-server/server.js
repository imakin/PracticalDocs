import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  listDocuments,
  readDocumentAsset,
  readDocumentFolder,
  removeDocument,
  writeDocument,
} from './documents.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = process.env.PORT || 3001
const DATA_DIR = path.join(__dirname, 'data')

// Ensure storage data directory exists
await fs.mkdir(DATA_DIR, { recursive: true })

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function sendJson(res, statusCode, payload) {
  setCorsHeaders(res)
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload, null, 2))
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
}

const contentTypeFor = (name) =>
  CONTENT_TYPES[path.extname(String(name || '')).toLowerCase()] || 'application/octet-stream'

function sanitizeFilename(input) {
  let str = String(input || 'file-identifier').trim()
  if (str === '测试文档') str = 'file-identifier'
  const cleaned = str
    .replaceAll(/[^a-zA-Z0-9_\-\.]/g, '_')
    .replaceAll(/_+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
  const finalName = cleaned || 'file-identifier'
  return finalName
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  try {
    // Health Check Endpoint
    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, {
        status: 'ok',
        server: 'practical-umodoc-server',
        time: new Date().toISOString(),
      })
      return
    }

    // Save Document (Encrypted Multi-file by filename/id)
    if (req.method === 'POST' && pathname === '/api/documents/save') {
      const body = await parseRequestBody(req)
      const rawTitle = (body.title && body.title.trim() && body.title.trim() !== '测试文档') ? body.title.trim() : 'file-identifier'
      const filename = sanitizeFilename(body.filename || body.id || rawTitle)
      const title = (rawTitle === 'file-identifier' && filename !== 'file-identifier') ? filename : rawTitle
      const docId = filename

      const documentPayload = {
        id: docId,
        filename,
        title,
        html: body.html || '',
        json: body.json || null,
        snapshot: body.snapshot || null,
        profiles: body.profiles || [],
        pageSettings: body.pageSettings || null,
        savedAt: new Date().toISOString(),
      }

      const { assets, missing } = await writeDocument(
        DATA_DIR,
        filename,
        documentPayload,
        Array.isArray(body.assets) ? body.assets : [],
      )

      sendJson(res, 200, {
        success: true,
        id: docId,
        filename,
        title,
        message: `Document '${filename}' saved to practical-umodoc-server successfully!`,
        savedAt: documentPayload.savedAt,
        assets,
        // Named so the client can resend them rather than leaving a document pointing at nothing.
        missingAssets: missing,
      })
      return
    }

    // List Saved Documents
    if (req.method === 'GET' && (pathname === '/api/documents/list' || pathname === '/api/documents')) {
      sendJson(res, 200, { success: true, documents: await listDocuments(DATA_DIR) })
      return
    }

    // Serve one file out of a document's assets folder.
    if (req.method === 'GET' && /^\/api\/documents\/[^/]+\/assets\/[^/]+$/.test(pathname)) {
      const [, , , rawName, , rawAsset] = pathname.split('/')
      const name = sanitizeFilename(decodeURIComponent(rawName))
      const assetName = decodeURIComponent(rawAsset)
      const asset = await readDocumentAsset(DATA_DIR, name, assetName)
      if (!asset) {
        sendJson(res, 404, { success: false, message: `Asset '${assetName}' not found.` })
        return
      }
      setCorsHeaders(res)
      res.writeHead(200, {
        'Content-Type': asset.type || contentTypeFor(asset.name),
        'Content-Length': asset.data.length,
        // The folder is editable by hand, so the file may change without the name changing.
        'Cache-Control': 'no-cache',
      })
      res.end(asset.data)
      return
    }

    // Load Single Document by query param or pathname (/api/documents/load?id=... or /api/documents/:id)
    if (req.method === 'GET' && (pathname === '/api/documents/load' || pathname.startsWith('/api/documents/'))) {
      let targetName = url.searchParams.get('id') || url.searchParams.get('filename')
      if (!targetName && pathname.startsWith('/api/documents/')) {
        targetName = pathname.replace('/api/documents/', '')
      }

      if (!targetName) {
        sendJson(res, 400, { success: false, message: 'Filename or document ID is required.' })
        return
      }

      const safeName = sanitizeFilename(targetName)
      try {
        const found = await readDocumentFolder(DATA_DIR, safeName)
        sendJson(res, 200, { success: true, document: found.document, assets: found.assets })
      } catch {
        sendJson(res, 404, { success: false, message: `Document '${safeName}' not found on server.` })
      }
      return
    }

    // Delete Document
    if (req.method === 'DELETE' && pathname.startsWith('/api/documents/')) {
      const docId = sanitizeFilename(pathname.replace('/api/documents/', ''))
      const removed = await removeDocument(DATA_DIR, docId)
      sendJson(res, removed ? 200 : 404, {
        success: removed,
        message: removed
          ? `Document '${docId}' deleted successfully.`
          : `Document '${docId}' not found.`,
      })
      return
    }

    // Default 404 Route
    sendJson(res, 404, { success: false, message: 'Endpoint not found' })
  } catch (error) {
    console.error('Server error:', error)
    sendJson(res, 500, { success: false, message: error.message || 'Internal Server Error' })
  }
})

server.listen(PORT, () => {
  console.log(`practical-umodoc-server running on http://localhost:${PORT}`)
})
