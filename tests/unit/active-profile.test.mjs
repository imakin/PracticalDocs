import assert from 'node:assert/strict'
import test from 'node:test'

import { effectiveTextStyle, profileForSelection } from '../../src/utils/active-profile.js'

// A minimal stand-in for a ProseMirror resolved position: enough depth to walk out of.
const stateWith = (chain) => ({
  selection: {
    $from: {
      depth: chain.length - 1,
      node: (depth) => chain[depth],
    },
  },
})
const block = (type, attrs = {}) => ({ type: { name: type }, attrs })

const PROFILES = [
  { id: 'profile-paragraph', fontSize: '12pt', fontFamily: 'Times New Roman' },
  { id: 'profile-h1', fontSize: '14pt', fontFamily: '' },
]

test('the profile of the block the cursor is in is found', () => {
  const state = stateWith([
    block('doc'),
    block('paragraph', { numberingProfileId: 'profile-paragraph' }),
  ])
  assert.equal(profileForSelection(state, PROFILES)?.id, 'profile-paragraph')
})

test('a cursor nested in a list item still finds the block profile', () => {
  const state = stateWith([
    block('doc'),
    block('bulletList'),
    block('listItem', { numberingProfileId: 'profile-h1' }),
    block('paragraph'),
  ])
  assert.equal(profileForSelection(state, PROFILES)?.id, 'profile-h1')
})

test('a block naming no profile yields nothing rather than guessing', () => {
  const state = stateWith([block('doc'), block('paragraph', {})])
  assert.equal(profileForSelection(state, PROFILES), null)
})

test('a profile id that no longer exists yields nothing', () => {
  const state = stateWith([
    block('doc'),
    block('paragraph', { numberingProfileId: 'profile-deleted' }),
  ])
  assert.equal(profileForSelection(state, PROFILES), null)
})

test('missing state or profiles is answered with null, not an exception', () => {
  assert.equal(profileForSelection(null, PROFILES), null)
  assert.equal(profileForSelection(stateWith([block('doc')]), []), null)
  assert.equal(profileForSelection({}, PROFILES), null)
})

test('what the user set on the block wins over the profile', () => {
  const state = stateWith([
    block('doc'),
    block('paragraph', { numberingProfileId: 'profile-paragraph' }),
  ])
  assert.equal(effectiveTextStyle(state, PROFILES, 'fontSize', '18pt'), '18pt')
})

test('with nothing set on the block the profile supplies the value', () => {
  const state = stateWith([
    block('doc'),
    block('paragraph', { numberingProfileId: 'profile-paragraph' }),
  ])
  assert.equal(effectiveTextStyle(state, PROFILES, 'fontSize', null), '12pt')
  assert.equal(effectiveTextStyle(state, PROFILES, 'fontFamily', undefined), 'Times New Roman')
})

test('a profile that leaves the field empty supplies nothing', () => {
  const state = stateWith([
    block('doc'),
    block('heading', { numberingProfileId: 'profile-h1' }),
  ])
  assert.equal(effectiveTextStyle(state, PROFILES, 'fontFamily', null), null)
  assert.equal(effectiveTextStyle(state, PROFILES, 'fontSize', null), '14pt')
})
