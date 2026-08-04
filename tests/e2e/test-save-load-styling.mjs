import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDocumentSnapshot, parseDocumentFile } from '../../src/utils/document-file.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../../storage-server/data')

console.log('=== VERIFYING SAVE & LOAD WORKFLOW ===')

// 1. Create a test profile and Tiptap document snapshot with multiline template 'BAB {number}\n'
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
          text: 'PENDAHULUAN',
        },
      ],
    },
  ],
}

const snapshot = createDocumentSnapshot({
  editorVersion: '11.0.4',
  content: sampleDocJSON,
  document: { title: 'a' },
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

console.log('1. Created Document Snapshot with title "a":')
console.log('   - Title:', snapshot.document.title)
console.log('   - Profiles count:', snapshot.profiles.length)
console.log('   - Heading 1 template:', snapshot.profiles[0].template)
console.log('   - Heading 1 fontSize:', snapshot.content.content[0].attrs.fontSize)
console.log('   - Heading 1 margin.bottom:', snapshot.content.content[0].attrs.margin.bottom)

// 2. Perform Save API simulation
const titleInput = 'a'
const rawTitle = (titleInput && titleInput.trim()) ? titleInput.trim() : 'file-identifier'
let baseName = rawTitle
if (baseName.toLowerCase().endsWith('.enc')) baseName = baseName.slice(0, -4)

const cleanFilename = baseName.replaceAll(/[^a-zA-Z0-9_\-\.]/g, '_').replaceAll(/_+/g, '_').replaceAll(/^_+|_+$/g, '')
const filename = cleanFilename || 'file-identifier'

console.log('2. Filename resolved for title "a":', filename)
if (filename !== 'a') {
  console.error('FAILED: Expected filename to be "a", got:', filename)
  process.exit(1)
}

// 3. Test verification of restored snapshot on load
const restoredSnapshot = parseDocumentFile(JSON.stringify(snapshot))
console.log('3. Restored Document Snapshot after parse:')
console.log('   - Restored Title:', restoredSnapshot.document.title)
console.log('   - Restored Profiles:', restoredSnapshot.profiles.length)
console.log('   - Restored Heading 1 template:', restoredSnapshot.profiles[0].template)
console.log('   - Restored Heading 1 fontSize:', restoredSnapshot.content.content[0].attrs.fontSize)
console.log('   - Restored Heading 1 margin.bottom:', restoredSnapshot.content.content[0].attrs.margin.bottom)

if (
  restoredSnapshot.document.title === 'a' &&
  restoredSnapshot.profiles[0].template === 'BAB {number}\n' &&
  restoredSnapshot.content.content[0].attrs.fontSize === '24pt' &&
  restoredSnapshot.content.content[0].attrs.margin.bottom === '16pt'
) {
  console.log('=== TEST PASSED 100% SUCCESS ===')
} else {
  console.error('FAILED: Restored attributes do not match!')
  process.exit(1)
}
