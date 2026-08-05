import assert from 'node:assert'
import {
  createDocumentSnapshot,
  parseDocumentFile,
} from '../../src/utils/document-file.js'

console.log('=== TEST FULL PROFILE SAVE & LOAD ATTRIBUTES ===')

const fullProfile = {
  id: 'profile-h1',
  name: 'Heading 1 Master Profile',
  enabled: true,
  targetType: 'heading',
  level: 1,
  style: 'roman-upper',
  template: 'BAB {number}\n',
  fontFamily: 'Arial',
  fontSize: '20pt',
  fontWeight: 'bold',
  lineHeight: '2',
  marginBottom: '24px',
  indent: 1,
  textAlign: 'justify',
}

const snapshot = createDocumentSnapshot({
  content: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: {
          level: 1,
          numberingProfileId: 'profile-h1',
          fontFamily: 'Arial',
          fontSize: '20pt',
          fontWeight: 'bold',
          lineHeight: '2',
          indent: 1,
          textAlign: 'justify',
          margin: { bottom: '24px' },
        },
        content: [{ type: 'text', text: 'Master Heading Test' }],
      },
    ],
  },
  document: { title: 'Full Profile Test' },
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
  profiles: [fullProfile],
  editorVersion: '11.0.4',
})

console.log('1. Saved Profile Object:', snapshot.profiles[0])
console.log('2. Saved Node Attrs:', snapshot.content.content[0].attrs)

const jsonString = JSON.stringify(snapshot)
const restored = parseDocumentFile(jsonString)

console.log('\n3. Restored Profile Object:', restored.profiles[0])
console.log('4. Restored Node Attrs:', restored.content.content[0].attrs)

// Assert Profile properties
assert.equal(restored.profiles[0].fontFamily, 'Arial')
assert.equal(restored.profiles[0].fontSize, '20pt')
assert.equal(restored.profiles[0].fontWeight, 'bold')
assert.equal(restored.profiles[0].lineHeight, '2')
assert.equal(restored.profiles[0].marginBottom, '24px')
assert.equal(restored.profiles[0].indent, 1)
assert.equal(restored.profiles[0].textAlign, 'justify')

// Assert Node Attrs properties
assert.equal(restored.content.content[0].attrs.fontFamily, 'Arial')
assert.equal(restored.content.content[0].attrs.fontSize, '20pt')
assert.equal(restored.content.content[0].attrs.fontWeight, 'bold')
assert.equal(restored.content.content[0].attrs.lineHeight, '2')
assert.equal(restored.content.content[0].attrs.margin.bottom, '24px')
assert.equal(restored.content.content[0].attrs.indent, 1)
assert.equal(restored.content.content[0].attrs.textAlign, 'justify')

console.log('\n=== ALL FULL PROFILE SAVE & LOAD ASSERTIONS PASSED 100% ===')
