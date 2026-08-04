import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReferencePlan } from '../../src/utils/document-references.js'
import { createDocumentSnapshot, parseDocumentFile } from '../../src/utils/document-file.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../../storage-server/data')

console.log('===================================================================')
console.log('  E2E END-USER COMPREHENSIVE WORKFLOW TEST: SAVE & LOAD ALL STYLES  ')
console.log('===================================================================')

// 1. Create a rich document representing real end-user document state (like main.json)
const userProfiles = [
  {
    id: 'profile-h1',
    name: 'Title 1 (H1)',
    enabled: true,
    style: 'roman-upper',
    template: 'BAB {number}\n',
    targetType: 'heading',
    level: 1,
    fontSize: '14pt',
    fontWeight: 'bold',
    lineHeight: '1.5',
    marginBottom: '4em',
  },
  {
    id: 'profile-h2',
    name: 'Title 2 (H2)',
    enabled: true,
    style: 'numeric',
    template: '{number}',
    targetType: 'heading',
    level: 2,
    fontSize: '12pt',
    fontWeight: 'bold',
    lineHeight: '1.5',
    marginBottom: '0px',
  },
]

const userDocJSON = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: {
        level: 1,
        id: 'heading-1-id',
        referenceId: 'heading-rplnkkr3ou',
        referenceNumber: 'I',
        referenceLabel: 'BAB I\n',
        numberingProfileId: 'profile-h1',
        numberStyle: 'roman-upper',
        numberTemplate: 'BAB {number}\n',
        fontSize: '14pt',
        fontWeight: 'bold',
        lineHeight: '1.5',
        textAlign: 'center',
        margin: { bottom: '4em' },
      },
      content: [
        {
          type: 'text',
          marks: [
            {
              type: 'textStyle',
              attrs: {
                fontFamily: '"Times New Roman"',
                fontSize: '14pt',
              },
            },
          ],
          text: 'PENDAHULUAN',
        },
      ],
    },
    {
      type: 'heading',
      attrs: {
        level: 2,
        id: 'heading-2-id',
        referenceId: 'heading-k60msbzzt6',
        referenceNumber: '1.1',
        referenceLabel: '1.1',
        numberingProfileId: 'profile-h2',
        numberStyle: 'numeric',
        numberTemplate: '{number}',
        fontSize: '12pt',
        fontWeight: 'bold',
        lineHeight: '1.5',
        margin: { bottom: '0px' },
      },
      content: [
        {
          type: 'text',
          marks: [
            {
              type: 'textStyle',
              attrs: {
                fontFamily: '"Times New Roman"',
                fontSize: '12pt',
              },
            },
          ],
          text: 'Arsitektur Sistem Dan Perkakas Otomasi Penelitian',
        },
      ],
    },
  ],
}

const snapshot = createDocumentSnapshot({
  editorVersion: '11.0.4',
  content: userDocJSON,
  document: { title: 'main' },
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
  profiles: userProfiles,
})

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
    if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data))
    req.end()
  })
}

async function runE2ETest() {
  console.log('\n1. SAVING DOCUMENT "main" TO STORAGE SERVER VIA HTTP API...')
  const postBody = {
    id: 'main',
    filename: 'main',
    title: 'main',
    html: '<h1 style="text-align:center;line-height:1.5;margin-bottom:4em;font-size:14pt;font-weight:bold;">BAB I<br>PENDAHULUAN</h1>',
    json: userDocJSON,
    snapshot,
    profiles: userProfiles,
  }

  const saveRes = await httpRequest('http://localhost:3001/api/documents/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, postBody)

  if (saveRes.status !== 200 || !saveRes.data.success) {
    throw new Error(`HTTP Save failed: ${JSON.stringify(saveRes.data)}`)
  }
  console.log('   [OK] Server Save Response:', saveRes.data.message)

  console.log('\n2. VERIFYING DISK FILES IN storage-server/data/ ...')
  const encPath = path.join(DATA_DIR, 'main.enc')
  const jsonPath = path.join(DATA_DIR, 'main.json')

  if (!fs.existsSync(encPath)) throw new Error('main.enc does not exist on disk!')
  if (!fs.existsSync(jsonPath)) throw new Error('main.json does not exist on disk!')

  console.log('   [OK] main.enc exists (size:', fs.statSync(encPath).size, 'bytes)')
  console.log('   [OK] main.json exists (size:', fs.statSync(jsonPath).size, 'bytes)')

  const rawJsonOnDisk = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  console.log('   [OK] main.json Title:', rawJsonOnDisk.title)
  console.log('   [OK] main.json Profiles count:', rawJsonOnDisk.profiles.length)

  console.log('\n3. LOADING DOCUMENT "main" FROM SERVER (SIMULATING END-USER BUKA/LOAD)...')
  const loadRes = await httpRequest('http://localhost:3001/api/documents/load?id=main')
  if (loadRes.status !== 200 || !loadRes.data.success) {
    throw new Error(`HTTP Load failed: ${JSON.stringify(loadRes.data)}`)
  }

  const loadedDoc = loadRes.data.document
  const loadedSnapshot = loadedDoc.snapshot
  console.log('   [OK] Loaded Document ID:', loadedDoc.id)
  console.log('   [OK] Loaded Document Title:', loadedDoc.title)

  console.log('\n4. COMPREHENSIVE STYLING & PROFILE VERIFICATION:')
  const h1Attrs = loadedSnapshot.content.content[0].attrs
  const h2Attrs = loadedSnapshot.content.content[1].attrs
  const h1TextStyle = loadedSnapshot.content.content[0].content[0].marks[0].attrs

  console.log('   - Heading 1 Number Template:', h1Attrs.numberTemplate, '(Has newline:', h1Attrs.numberTemplate.includes('\n'), ')')
  console.log('   - Heading 1 Reference Label:', h1Attrs.referenceLabel, '(Has newline:', h1Attrs.referenceLabel.includes('\n'), ')')
  console.log('   - Heading 1 Font Size:', h1Attrs.fontSize)
  console.log('   - Heading 1 Font Weight:', h1Attrs.fontWeight)
  console.log('   - Heading 1 Line Height:', h1Attrs.lineHeight)
  console.log('   - Heading 1 Text Align:', h1Attrs.textAlign)
  console.log('   - Heading 1 Margin Bottom:', h1Attrs.margin.bottom)
  console.log('   - Heading 1 Font Family:', h1TextStyle.fontFamily)

  console.log('   - Heading 2 Font Size:', h2Attrs.fontSize)
  console.log('   - Heading 2 Font Weight:', h2Attrs.fontWeight)
  console.log('   - Heading 2 Line Height:', h2Attrs.lineHeight)
  console.log('   - Heading 2 Margin Bottom:', h2Attrs.margin.bottom)

  // Assertions for end-user perfection
  const checks = [
    h1Attrs.numberTemplate === 'BAB {number}\n',
    h1Attrs.referenceLabel === 'BAB I\n',
    h1Attrs.fontSize === '14pt',
    h1Attrs.fontWeight === 'bold',
    h1Attrs.lineHeight === '1.5',
    h1Attrs.textAlign === 'center',
    h1Attrs.margin.bottom === '4em',
    h1TextStyle.fontFamily === '"Times New Roman"',
    h2Attrs.fontSize === '12pt',
    h2Attrs.fontWeight === 'bold',
    h2Attrs.lineHeight === '1.5',
    h2Attrs.margin.bottom === '0px',
  ]

  if (checks.every(Boolean)) {
    console.log('\n===================================================================')
    console.log('  E2E END-USER TEST PASSED 100%: ALL STYLES, NEWLINES, & PROFILES ')
    console.log('  ARE FULLY PRESERVED & RESTORED LOSSLESSLY UPON LOAD!             ')
    console.log('===================================================================')
  } else {
    throw new Error('E2E FAILURE: One or more styling attributes were corrupted or missing on load!')
  }
}

runE2ETest().catch((err) => {
  console.error('\nE2E TEST FAILED:', err.message)
  process.exit(1)
})
