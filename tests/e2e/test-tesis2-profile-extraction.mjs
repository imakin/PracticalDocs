import assert from 'node:assert'
import { buildReferencePlan } from '../../src/utils/document-references.js'

console.log('=== TEST TESIS2 PROFILE ATTRIBUTE EXTRACTION ===')

const sampleDescriptors = [
  {
    pos: 1,
    targetType: 'heading',
    level: 1,
    numberingProfileId: 'profile-h1',
    fontFamily: 'Noto Serif SC',
    fontSize: '14pt',
    fontWeight: 'bold',
    lineHeight: '1.5',
    marginBottom: '4em',
    textAlign: 'center',
  },
  {
    pos: 10,
    targetType: 'paragraph',
    numberingProfileId: 'profile-paragraph',
    fontFamily: 'Noto Serif SC',
    fontSize: '12pt',
    fontWeight: 'normal',
    lineHeight: '1.5',
    marginBottom: '0.25em',
    indent: 1,
    textAlign: 'left',
  },
]

const initialProfiles = [
  {
    id: 'profile-paragraph',
    name: 'Normal (Text)',
    enabled: false,
    style: 'numeric',
    template: '',
    targetType: 'paragraph',
  },
  {
    id: 'profile-h1',
    name: 'Title 1 (H1)',
    enabled: true,
    style: 'roman-upper',
    template: 'BAB {number}\n',
    targetType: 'heading',
    level: 1,
  },
]

const plan = buildReferencePlan(sampleDescriptors, {
  profiles: initialProfiles,
})

console.log('1. Extracted Normal Profile:', initialProfiles[0])
console.log('2. Extracted H1 Profile:', initialProfiles[1])

// Assert Normal Profile attributes extracted from tesis2 node
assert.equal(initialProfiles[0].fontFamily, 'Noto Serif SC')
assert.equal(initialProfiles[0].fontSize, '12pt')
assert.equal(initialProfiles[0].fontWeight, 'normal')
assert.equal(initialProfiles[0].lineHeight, '1.5')
assert.equal(initialProfiles[0].marginBottom, '0.25em')
assert.equal(initialProfiles[0].indent, 1)
assert.equal(initialProfiles[0].textAlign, 'left')

// Assert H1 Profile attributes extracted from tesis2 node
assert.equal(initialProfiles[1].fontFamily, 'Noto Serif SC')
assert.equal(initialProfiles[1].fontSize, '14pt')
assert.equal(initialProfiles[1].fontWeight, 'bold')
assert.equal(initialProfiles[1].lineHeight, '1.5')
assert.equal(initialProfiles[1].marginBottom, '4em')
assert.equal(initialProfiles[1].textAlign, 'center')

console.log('\n=== ALL TESIS2 PROFILE EXTRACTION ASSERTIONS PASSED 100% ===')
