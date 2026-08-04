import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDocumentSnapshot, parseDocumentFile } from '../../src/utils/document-file.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../../storage-server/data')

console.log('=====================================================')
console.log('  FULL REAL HTTP SERVER INTEGRATION & DISK FILE TEST ')
console.log('=====================================================')

// 1. Ensure storage-server data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

// 2. Prepare full test payload with identifier 'a' and multiline profile styling
const testTitle = 'a'
const sampleProfiles = [
  {
    id: 'profile-h1',
    name: 'Title 1 (H1)',
    enabled: true,
    style: 'roman-upper',
    template: 'BAB {number}\n',
    targetType: 'heading',
    level: 1,
    fontSize: '24pt',
    fontWeight: 'bold',
    lineHeight: '1.5',
    marginBottom: '16pt',
  },
]

const sampleDocJSON = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: {
        level: 1,
        referenceId: 'heading-bab1',
        referenceNumber: 'I',
        referenceLabel: 'BAB I\n',
        numberingProfileId: 'profile-h1',
        numberStyle: 'roman-upper',
        numberTemplate: 'BAB {number}\n',
        fontSize: '24pt',
        fontWeight: 'bold',
        lineHeight: '1.5',
        margin: { bottom: '16pt' },
      },
      content: [
        {
          type: 'text',
          text: 'PENDAHULUAN UTAMA',
        },
      ],
    },
  ],
}

const snapshot = createDocumentSnapshot({
  editorVersion: '11.0.4',
  content: sampleDocJSON,
  document: { title: testTitle },
  page: {
    layout: 'page',
    size: { label: { en_US: 'A4', zh_CN: 'A4' }, width: 21, height: 29.7 },
    margin: { left: 3.18, right: 3.18, top: 2.54, bottom: 2.54 },
    orientation: 'portrait',
    background: '#ffffff',
    watermark: { type: 'compact', alpha: 0.2, fontColor: '#000000', fontSize: 16, fontFamily: null, fontWeight: 'normal', text: '' },
    showBreakMarks: false,
    showLineNumber: false,
    showBookmark: false,
    showToc: false,
  },
  profiles: sampleProfiles,
})

// Helper for HTTP requests
function httpRequest(url, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const reqOpts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    }

    const req = http.request(reqOpts, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) })
        } catch {
          resolve({ status: res.statusCode, raw: body })
        }
      })
    })

    req.on('error', reject)
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data))
    }
    req.end()
  })
}

async function run() {
  try {
    // 3. Send REAL HTTP POST request to storage-server (port 3001)
    console.log(`\nSTEP 1: Sending POST save request for document title "${testTitle}" to http://localhost:3001/api/documents/save ...`)
    const postBody = {
      id: testTitle,
      filename: testTitle,
      title: testTitle,
      html: '<h1 style="font-size:24pt;font-weight:bold;line-height:1.5;margin-bottom:16pt;">BAB I<br>PENDAHULUAN UTAMA</h1>',
      json: sampleDocJSON,
      snapshot,
      profiles: sampleProfiles,
    }

    const saveRes = await httpRequest('http://localhost:3001/api/documents/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, postBody)

    console.log('   -> HTTP Status:', saveRes.status)
    console.log('   -> Response:', JSON.stringify(saveRes.data))

    if (saveRes.status !== 200 || !saveRes.data.success) {
      throw new Error(`Save failed with status ${saveRes.status}: ${JSON.stringify(saveRes.data)}`)
    }

    // 4. PHYSICALLY CHECK DISK FILE in storage-server/data/a.enc
    const expectedFilePath = path.join(DATA_DIR, 'a.enc')
    console.log(`\nSTEP 2: Checking physical disk file existence at: ${expectedFilePath}`)
    const fileExists = fs.existsSync(expectedFilePath)
    console.log('   -> File exists on disk:', fileExists)

    if (!fileExists) {
      throw new Error(`CRITICAL FAILURE: Physical file "${expectedFilePath}" WAS NOT CREATED ON DISK!`)
    }

    const fileStats = fs.statSync(expectedFilePath)
    console.log('   -> Physical file size on disk:', fileStats.size, 'bytes')

    // 5. Send REAL HTTP GET load request to storage-server for document 'a'
    console.log(`\nSTEP 3: Sending GET load request for id "a" to http://localhost:3001/api/documents/load?id=a ...`)
    const loadRes = await httpRequest('http://localhost:3001/api/documents/load?id=a')
    console.log('   -> HTTP Status:', loadRes.status)
    console.log('   -> Response Document Title:', loadRes.data?.document?.title)
    console.log('   -> Response Document Filename:', loadRes.data?.document?.filename)

    if (loadRes.status !== 200 || !loadRes.data.success) {
      throw new Error(`Load failed with status ${loadRes.status}: ${JSON.stringify(loadRes.data)}`)
    }

    const loadedDoc = loadRes.data.document
    const loadedSnapshot = loadedDoc.snapshot

    // 6. VERIFY ALL STYLING, PROFILES, AND ATTRIBUTES IN LOADED SNAPSHOT
    console.log('\nSTEP 4: Verifying loaded styling and profile attributes:')
    console.log('   - Loaded Document Title:', loadedDoc.title)
    console.log('   - Loaded Profiles Count:', loadedDoc.profiles.length)
    console.log('   - Profile H1 Template:', loadedDoc.profiles[0]?.template)
    console.log('   - Profile H1 Font Size:', loadedDoc.profiles[0]?.fontSize)
    console.log('   - Profile H1 Font Weight:', loadedDoc.profiles[0]?.fontWeight)
    console.log('   - Profile H1 Line Height:', loadedDoc.profiles[0]?.lineHeight)
    console.log('   - Profile H1 Margin Bottom:', loadedDoc.profiles[0]?.marginBottom)
    console.log('   - Node Attrs Number Template:', loadedSnapshot?.content?.content[0]?.attrs?.numberTemplate)
    console.log('   - Node Attrs Font Size:', loadedSnapshot?.content?.content[0]?.attrs?.fontSize)
    console.log('   - Node Attrs Margin Bottom:', loadedSnapshot?.content?.content[0]?.attrs?.margin?.bottom)

    if (
      loadedDoc.title === 'a' &&
      loadedDoc.profiles[0]?.template === 'BAB {number}\n' &&
      loadedDoc.profiles[0]?.fontSize === '24pt' &&
      loadedDoc.profiles[0]?.marginBottom === '16pt' &&
      loadedSnapshot?.content?.content[0]?.attrs?.numberTemplate === 'BAB {number}\n' &&
      loadedSnapshot?.content?.content[0]?.attrs?.fontSize === '24pt' &&
      loadedSnapshot?.content?.content[0]?.attrs?.margin?.bottom === '16pt'
    ) {
      console.log('\n=====================================================')
      console.log('  SUCCESS: FILE a.enc PHYSICALLY EXISTS ON DISK &    ')
      console.log('  ALL STYLING ATTRIBUTES FULLY VERIFIED 100% SUCCESS  ')
      console.log('=====================================================')
    } else {
      throw new Error('CRITICAL FAILURE: Loaded attributes do not match expected styling!')
    }
  } catch (err) {
    console.error('\nTEST FAILED WITH ERROR:', err.message)
    process.exit(1)
  }
}

run()
