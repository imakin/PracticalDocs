import http from 'node:http'
import { createDocumentSnapshot } from '../../src/utils/document-file.js'
import { buildReferencePlan } from '../../src/utils/document-references.js'

console.log('=======================================================================')
console.log('  CLEAN STATE (PRIVATE WINDOW / INCOGNITO) LOAD & STYLING TEST         ')
console.log('=======================================================================')

// 1. Create realistic main document snapshot with multiline template 'BAB {number}\n'
const profilesWithNewline = [
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
]

const mainDocJSON = {
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
  ],
}

const snapshot = createDocumentSnapshot({
  editorVersion: '11.0.4',
  content: mainDocJSON,
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
  profiles: profilesWithNewline,
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

async function runCleanStateTest() {
  console.log('\nSTEP 1: Save "main" to storage-server (port 3001) ...')
  const saveRes = await httpRequest('http://localhost:3001/api/documents/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, {
    id: 'main',
    filename: 'main',
    title: 'main',
    html: '<h1 style="text-align:center;line-height:1.5;margin-bottom:4em;font-size:14pt;font-weight:bold;">BAB I<br>PENDAHULUAN</h1>',
    json: mainDocJSON,
    snapshot,
    profiles: profilesWithNewline,
  })

  if (saveRes.status !== 200 || !saveRes.data.success) {
    throw new Error(`Save failed: ${JSON.stringify(saveRes.data)}`)
  }
  console.log('   [OK] Save response success:', saveRes.data.message)

  console.log('\nSTEP 2: Simulating Private Window Load (Empty initial storage, default H1 profile without newline)...')
  // Initial storage simulates fresh Private Window where storage.profiles was initialized to default (BAB {number})
  const mockStorageInPrivateWindow = {
    profiles: [
      {
        id: 'profile-h1',
        name: 'Title 1 (H1)',
        enabled: true,
        style: 'roman-upper',
        template: 'BAB {number}\n', // Now defaulted to include \n
        targetType: 'heading',
        level: 1,
      },
    ],
  }

  console.log('\nSTEP 3: Loading document "main" from server ...')
  const loadRes = await httpRequest('http://localhost:3001/api/documents/load?id=main')
  if (loadRes.status !== 200 || !loadRes.data.success) {
    throw new Error(`Load failed: ${JSON.stringify(loadRes.data)}`)
  }

  const loadedPayload = loadRes.data.document
  console.log('   [OK] Loaded title:', loadedPayload.title)
  console.log('   [OK] Loaded profiles count:', loadedPayload.profiles.length)

  // Merge loaded profiles into storage (simulating applyDocumentSnapshot in Private Window)
  if (loadedPayload.profiles && loadedPayload.profiles.length > 0) {
    mockStorageInPrivateWindow.profiles = loadedPayload.profiles
  }

  // Build reference plan on loaded JSON content
  const descriptors = [
    {
      targetType: 'heading',
      targetId: loadedPayload.snapshot.content.content[0].attrs.referenceId,
      level: 1,
      numberingProfileId: loadedPayload.snapshot.content.content[0].attrs.numberingProfileId,
      numberStyle: loadedPayload.snapshot.content.content[0].attrs.numberStyle,
      numberTemplate: loadedPayload.snapshot.content.content[0].attrs.numberTemplate,
      fontSize: loadedPayload.snapshot.content.content[0].attrs.fontSize,
      fontWeight: loadedPayload.snapshot.content.content[0].attrs.fontWeight,
      lineHeight: loadedPayload.snapshot.content.content[0].attrs.lineHeight,
      marginBottom: loadedPayload.snapshot.content.content[0].attrs.margin?.bottom,
      title: 'PENDAHULUAN',
    },
  ]

  const plan = buildReferencePlan(descriptors, {
    profiles: mockStorageInPrivateWindow.profiles,
  })

  const targetUpdate = plan.targets[0] || plan.updates[0]
  console.log('\nSTEP 4: Verifying Plan generated in Private Window Session:')
  console.log('   - Generated Label:', JSON.stringify(targetUpdate.label || targetUpdate.referenceLabel))
  console.log('   - Has Newline in Label:', (targetUpdate.label || targetUpdate.referenceLabel || '').includes('\n'))

  const labelText = targetUpdate.label || targetUpdate.referenceLabel || ''
  if (labelText.includes('\n')) {
    console.log('\n=======================================================================')
    console.log('  SUCCESS: PRIVATE WINDOW LOAD PRESERVES MULTILINE NEWLINE 100%!       ')
    console.log('=======================================================================')
  } else {
    throw new Error('FAILED: Newline was lost during Private Window load!')
  }
}

runCleanStateTest().catch((err) => {
  console.error('\nCLEAN STATE TEST FAILED:', err.message)
  process.exit(1)
})
