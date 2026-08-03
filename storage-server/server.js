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

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res)

  // Handle Preflight OPTIONS
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

    // Save Document (Encrypted)
    if (req.method === 'POST' && pathname === '/api/documents/save') {
      const body = await parseRequestBody(req)
      const docId = body.id || body.docId || `doc_${Date.now()}`
      const title = body.title || 'Untitled Document'

      const documentPayload = {
        id: docId,
        title,
        html: body.html || '',
        json: body.json || null,
        pageSettings: body.pageSettings || null,
        savedAt: new Date().toISOString(),
      }

      // Encrypt document before saving to disk
      const encryptedData = encryptPayload(documentPayload)
      const filePath = path.join(DATA_DIR, `${docId}.enc`)
      await fs.writeFile(filePath, encryptedData, 'utf8')

      sendJson(res, 200, {
        success: true,
        id: docId,
        message: 'Document encrypted and saved successfully to practical-umodoc-server',
        savedAt: documentPayload.savedAt,
      })
      return
    }

    // List Saved Documents
    if (req.method === 'GET' && pathname === '/api/documents') {
      const files = await fs.readdir(DATA_DIR)
      const documents = []

      for (const file of files) {
        if (file.endsWith('.enc')) {
          try {
            const rawContent = await fs.readFile(path.join(DATA_DIR, file), 'utf8')
            const decrypted = decryptPayload(rawContent)
            documents.push({
              id: decrypted.id,
              title: decrypted.title,
              savedAt: decrypted.savedAt,
            })
          } catch (e) {
            console.error(`Failed to decrypt ${file}:`, e.message)
          }
        }
      }

      sendJson(res, 200, { success: true, documents })
      return
    }

    // Get Single Document by ID
    if (req.method === 'GET' && pathname.startsWith('/api/documents/')) {
      const docId = pathname.replace('/api/documents/', '')
      const filePath = path.join(DATA_DIR, `${docId}.enc`)

      try {
        const rawContent = await fs.readFile(filePath, 'utf8')
        const decrypted = decryptPayload(rawContent)
        sendJson(res, 200, { success: true, document: decrypted })
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
  console.log(`[practical-umodoc-server] Running on http://localhost:${PORT}`)
  console.log(`[practical-umodoc-server] Encrypted storage dir: ${DATA_DIR}`)
})
