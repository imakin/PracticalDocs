import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_TOC_INDENT_FROM,
  DEFAULT_TOC_INDENT_STEP,
  DEFAULT_TOC_PROFILE_ID,
  resolveTocProfile,
  tocIndentDepth,
  tocIndentOf,
} from '../../src/utils/toc-indent.js'

test('nothing above the starting level is indented', () => {
  assert.equal(tocIndentDepth(1, 2), 0)
  assert.equal(tocIndentDepth(2, 2), 1)
  assert.equal(tocIndentDepth(3, 2), 2)
  assert.equal(tocIndentDepth(6, 2), 5)
})

test('the starting level is what decides, not the heading level', () => {
  assert.equal(tocIndentDepth(2, 3), 0)
  assert.equal(tocIndentDepth(3, 3), 1)
  assert.equal(tocIndentDepth(1, 1), 1)
})

test('an absent starting level falls back to the default rather than indenting everything', () => {
  assert.equal(tocIndentDepth(1, undefined), tocIndentDepth(1, DEFAULT_TOC_INDENT_FROM))
  assert.equal(tocIndentDepth(1, null), 0)
  assert.equal(tocIndentDepth(2, 'not a number'), 1)
})

test('the step multiplies by the depth', () => {
  const profile = { tocIndent: '2em', tocIndentFrom: 2 }
  assert.equal(tocIndentOf(1, profile), '')
  assert.equal(tocIndentOf(2, profile), '2em')
  assert.equal(tocIndentOf(3, profile), '4em')
  assert.equal(tocIndentOf(4, profile), '6em')
})

test('a step without a unit is read as em', () => {
  assert.equal(tocIndentOf(3, { tocIndent: '1.5', tocIndentFrom: 2 }), '3em')
})

test('other units are kept', () => {
  assert.equal(tocIndentOf(3, { tocIndent: '12px', tocIndentFrom: 2 }), '24px')
  assert.equal(tocIndentOf(2, { tocIndent: '5%', tocIndentFrom: 2 }), '5%')
})

test('a step of zero, or an empty step, means a flat list', () => {
  assert.equal(tocIndentOf(4, { tocIndent: '0', tocIndentFrom: 2 }), '')
  assert.equal(tocIndentOf(4, { tocIndent: '0em', tocIndentFrom: 2 }), '')
  assert.equal(tocIndentOf(4, { tocIndent: '', tocIndentFrom: 2 }), '')
})

test('a missing profile takes the defaults rather than failing', () => {
  assert.equal(tocIndentOf(1, null), '')
  assert.equal(tocIndentOf(2, null), DEFAULT_TOC_INDENT_STEP)
  assert.equal(tocIndentOf(2, {}), DEFAULT_TOC_INDENT_STEP)
})

test('a step it cannot parse is honoured as calc rather than dropped', () => {
  assert.equal(tocIndentOf(3, { tocIndent: 'var(--x)', tocIndentFrom: 2 }), 'calc(var(--x) * 2)')
})

test('long decimals are rounded rather than printed in full', () => {
  assert.equal(tocIndentOf(4, { tocIndent: '0.3333em', tocIndentFrom: 2 }), '1em')
  assert.equal(tocIndentOf(3, { tocIndent: '0.3333em', tocIndentFrom: 2 }), '0.667em')
})

test('a document map uses the profile it names', () => {
  const profiles = [
    { id: 'profile-toc', targetType: 'toc', name: 'Table of Contents' },
    { id: 'profile-figures', targetType: 'toc', name: 'List of Figures' },
    { id: 'profile-h1', targetType: 'heading' },
  ]
  assert.equal(resolveTocProfile(profiles, 'profile-figures').id, 'profile-figures')
})

test('naming nothing means the built-in, wherever it sits in the list', () => {
  const profiles = [
    { id: 'profile-figures', targetType: 'toc' },
    { id: 'profile-toc', targetType: 'toc' },
  ]
  assert.equal(resolveTocProfile(profiles, null).id, DEFAULT_TOC_PROFILE_ID)
  assert.equal(resolveTocProfile(profiles, '').id, DEFAULT_TOC_PROFILE_ID)
})

test('a deleted profile falls back rather than leaving the map unstyled', () => {
  const profiles = [{ id: 'profile-toc', targetType: 'toc' }]
  assert.equal(resolveTocProfile(profiles, 'profile-gone').id, DEFAULT_TOC_PROFILE_ID)
})

test('with the built-in deleted, any contents profile is used', () => {
  const profiles = [{ id: 'profile-figures', targetType: 'toc' }]
  assert.equal(resolveTocProfile(profiles, null).id, 'profile-figures')
})

test('no contents profile at all resolves to nothing, and the defaults apply', () => {
  assert.equal(resolveTocProfile([{ id: 'profile-h1', targetType: 'heading' }], null), null)
  assert.equal(resolveTocProfile([], null), null)
  assert.equal(resolveTocProfile(null, null), null)
})

test('a profile that is not a contents profile is never chosen, even when named', () => {
  const profiles = [
    { id: 'profile-toc', targetType: 'toc' },
    { id: 'profile-h1', targetType: 'heading' },
  ]
  assert.equal(resolveTocProfile(profiles, 'profile-h1').id, DEFAULT_TOC_PROFILE_ID)
})
