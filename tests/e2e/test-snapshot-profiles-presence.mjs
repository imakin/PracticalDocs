import assert from 'node:assert'
import { createDocumentSnapshot } from '../../src/utils/document-file.js'

console.log('=== TEST SNAPSHOT PROFILES PRESENCE ===')

const mockProfiles = [
  {
    id: 'profile-paragraph',
    name: 'Normal (Text)',
    enabled: false,
    style: 'numeric',
    template: '',
    targetType: 'paragraph',
    fontFamily: 'Noto Serif SC',
    fontSize: '12pt',
    lineHeight: '1.5',
  },
  {
    id: 'profile-h1',
    name: 'Title 1 (H1)',
    enabled: true,
    style: 'roman-upper',
    template: 'BAB {number}\n',
    targetType: 'heading',
    level: 1,
    fontFamily: 'Noto Serif SC',
    fontSize: '14pt',
    fontWeight: 'bold',
  },
]

const snapshot = createDocumentSnapshot({
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }],
  },
  document: { title: 'tesis3' },
  page: {
    layout: 'page',
    size: { label: 'A4', width: 21, height: 29.7 },
    margin: { left: 2.5, right: 2.5, top: 3, bottom: 2.5 },
    orientation: 'portrait',
    background: '#ffffff',
    watermark: {
      type: 'compact',
      alpha: 0.2,
      fontColor: '#000000',
      fontSize: 14,
      fontFamily: null,
      fontWeight: 'normal',
      text: '',
    },
    showBreakMarks: true,
    showLineNumber: false,
    showBookmark: false,
    showToc: false,
  },
  profiles: mockProfiles,
  editorVersion: '11.0.4',
})

console.log('1. Generated Snapshot Profiles Length:', snapshot.profiles.length)
console.log('2. Generated Snapshot Profiles[0]:', snapshot.profiles[0])
console.log('3. Generated Snapshot Profiles[1]:', snapshot.profiles[1])

assert.equal(snapshot.profiles.length, 2, 'Profiles array in snapshot must not be empty!')
assert.equal(snapshot.profiles[0].id, 'profile-paragraph')
assert.equal(snapshot.profiles[0].fontFamily, 'Noto Serif SC')
assert.equal(snapshot.profiles[1].id, 'profile-h1')
assert.equal(snapshot.profiles[1].fontSize, '14pt')

console.log('\n=== ALL SNAPSHOT PROFILES PRESENCE ASSERTIONS PASSED 100% ===')
