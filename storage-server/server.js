import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encryptPayload, decryptPayload } from './crypto-utils.js'

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

function sanitizeFilename(input) {
  let str = String(input || 'file-identifier').trim()
  if (str === '测试文档') str = 'file-identifier'
  const cleaned = str
    .replaceAll(/[^a-zA-Z0-9_\-\.]/g, '_')
    .replaceAll(/_+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
  const finalName = cleaned || 'file-identifier'
  return finalName.endsWith('.enc') ? finalName.slice(0, -4) : finalName
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

      // Encrypt document before saving to disk
      const encryptedData = encryptPayload(documentPayload)
      const filePath = path.join(DATA_DIR, `${filename}.enc`)
      await fs.writeFile(filePath, encryptedData, 'utf8')

      // DEBUG MODE: Save human-readable unencrypted JSON file alongside .enc file
      const debugJsonPath = path.join(DATA_DIR, `${filename}.json`)
      await fs.writeFile(debugJsonPath, JSON.stringify(documentPayload, null, 2), 'utf8')

      sendJson(res, 200, {
        success: true,
        id: docId,
        filename,
        title,
        message: `Dokumen '${filename}' berhasil dienskripsi & disimpan ke practical-umodoc-server!`,
        savedAt: documentPayload.savedAt,
      })
      return
    }

    // List Saved Documents
    if (req.method === 'GET' && (pathname === '/api/documents/list' || pathname === '/api/documents')) {
      const files = await fs.readdir(DATA_DIR)
      const documents = []

      for (const file of files) {
        if (file.endsWith('.enc')) {
          try {
            const rawContent = await fs.readFile(path.join(DATA_DIR, file), 'utf8')
            const decrypted = decryptPayload(rawContent)
            let rawFilename = decrypted.filename || file.replace(/\.enc$/, '')
            if (!rawFilename || rawFilename.replaceAll('_', '') === '') rawFilename = 'file-identifier'
            let rawTitle = decrypted.title || 'file-identifier'
            if (!rawTitle || rawTitle === '测试文档' || rawTitle.replaceAll('_', '') === '') rawTitle = rawFilename
            documents.push({
              id: rawFilename,
              filename: rawFilename,
              title: rawTitle,
              savedAt: decrypted.savedAt || new Date().toISOString(),
            })
          } catch (e) {
            console.error(`Failed to decrypt ${file}:`, e.message)
          }
        }
      }

      // Sort newest saved first
      documents.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))

      sendJson(res, 200, { success: true, documents })
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
      let filePath = path.join(DATA_DIR, `${safeName}.enc`)

      try {
        let rawContent
        try {
          rawContent = await fs.readFile(filePath, 'utf8')
        } catch {
          const rawName = String(targetName).trim().replace(/\.enc$/i, '')
          const altPath = path.join(DATA_DIR, `${rawName}.enc`)
          rawContent = await fs.readFile(altPath, 'utf8')
        }
        const decrypted = decryptPayload(rawContent)
        sendJson(res, 200, { success: true, document: decrypted })
      } catch {
        sendJson(res, 404, { success: false, message: `Document '${safeName}' not found on server.` })
      }
      return
    }

    // Delete Document
    if (req.method === 'DELETE' && pathname.startsWith('/api/documents/')) {
      const docId = sanitizeFilename(pathname.replace('/api/documents/', ''))
      const filePath = path.join(DATA_DIR, `${docId}.enc`)

      try {
        await fs.unlink(filePath)
        sendJson(res, 200, { success: true, message: `Document '${docId}' deleted successfully.` })
      } catch {
        sendJson(res, 404, { success: false, message: `Document '${docId}' not found.` })
      }
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
