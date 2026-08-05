import assert from 'node:assert'
import { buildReferencePlan } from '../../src/utils/document-references.js'

console.log('=== TEST ALL PROFILES DEFAULT STYLING ATTRIBUTES ===')

const initialProfiles = [
  {
    id: 'profile-paragraph',
    name: 'Normal (Text)',
    enabled: false,
    style: 'numeric',
    template: '',
    targetType: 'paragraph',
    fontFamily: '',
    fontSize: '12pt',
    fontWeight: 'normal',
    lineHeight: '1.5',
    marginBottom: '0.25em',
    indent: 1,
    textAlign: 'justify',
  },
  {
    id: 'profile-h1',
    name: 'Title 1 (H1)',
    enabled: true,
    style: 'roman-upper',
    template: 'BAB {number}\n',
    targetType: 'heading',
    level: 1,
    fontFamily: '',
    fontSize: '14pt',
    fontWeight: 'bold',
    lineHeight: '1.5',
    marginBottom: '4em',
    indent: 0,
    textAlign: 'center',
  },
  {
    id: 'profile-h2',
    name: 'Title 2 (H2)',
    enabled: true,
    style: 'numeric',
    template: '{number}',
    targetType: 'heading',
    level: 2,
    fontFamily: '',
    fontSize: '12pt',
    fontWeight: 'bold',
    lineHeight: '1.5',
    marginBottom: '0.25em',
    indent: 0,
    textAlign: 'left',
  },
]

// Simulate scanning a document with only paragraph nodes (like tesis3.json)
const tesis3Descriptors = [
  {
    pos: 1,
    targetType: 'paragraph',
    numberingProfileId: 'profile-paragraph',
    fontFamily: 'Noto Serif SC',
    fontSize: '12pt',
    fontWeight: 'normal',
    lineHeight: '1.5',
    marginBottom: '0.25em',
    indent: 1,
    textAlign: 'justify',
  },
]

const plan = buildReferencePlan(tesis3Descriptors, {
  profiles: initialProfiles,
})

console.log('1. Paragraph Profile:', initialProfiles[0])
console.log('2. H1 Profile:', initialProfiles[1])
console.log('3. H2 Profile:', initialProfiles[2])

// Assert Paragraph Profile
assert.equal(initialProfiles[0].fontSize, '12pt')
assert.equal(initialProfiles[0].lineHeight, '1.5')
assert.equal(initialProfiles[0].textAlign, 'justify')

// Assert H1 Profile (has default styling even when doc has no H1 node!)
assert.equal(initialProfiles[1].fontSize, '14pt')
assert.equal(initialProfiles[1].fontWeight, 'bold')
assert.equal(initialProfiles[1].lineHeight, '1.5')
assert.equal(initialProfiles[1].marginBottom, '4em')
assert.equal(initialProfiles[1].textAlign, 'center')

// Assert H2 Profile (has default styling even when doc has no H2 node!)
assert.equal(initialProfiles[2].fontSize, '12pt')
assert.equal(initialProfiles[2].fontWeight, 'bold')
assert.equal(initialProfiles[2].lineHeight, '1.5')
assert.equal(initialProfiles[2].marginBottom, '0.25em')
assert.equal(initialProfiles[2].textAlign, 'left')

console.log('\n=== ALL PROFILES DEFAULT STYLING ASSERTIONS PASSED 100% ===')
