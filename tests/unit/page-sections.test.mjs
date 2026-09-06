import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeSectionMargin,
  normalizeSectionSize,
  resolveSections,
  sameGeometry,
  sectionIndexAt,
  sheetSizeOf,
  widestSheet,
} from '../../src/utils/page-sections.js'

const a4 = { label: 'A4', width: 21, height: 29.7 }
const margin = { top: 2.54, right: 2.54, bottom: 2.54, left: 2.54 }
const page = { size: a4, orientation: 'portrait', margin }

test('a document with no page break is one section', () => {
  const sections = resolveSections([], page)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].openedBy, null)
  assert.equal(sections[0].closedBy, null)
  assert.equal(sections[0].orientation, 'portrait')
})

test('the first section is the document settings', () => {
  const sections = resolveSections([{ id: 'aaaa', pos: 12 }], page)
  assert.deepEqual(sections[0].size, a4)
  assert.deepEqual(sections[0].margin, margin)
  assert.equal(sections[0].closedBy, 'aaaa')
})

test('a break that sets nothing carries the section before it on', () => {
  // This is what every page break in every document written before sections existed looks like, so
  // it is the case that must not change anything.
  const sections = resolveSections([{ id: 'aaaa', pos: 12 }], page)
  assert.equal(sections.length, 2)
  assert.deepEqual(sections[1].size, a4)
  assert.equal(sections[1].orientation, 'portrait')
  assert.deepEqual(sections[1].margin, margin)
})

test('a break can turn the paper, and the next one keeps it turned', () => {
  const sections = resolveSections(
    [
      { id: 'aaaa', pos: 12, orientation: 'landscape' },
      { id: 'bbbb', pos: 40 },
    ],
    page,
  )
  assert.equal(sections[1].orientation, 'landscape')
  assert.equal(sections[2].orientation, 'landscape')
  assert.equal(sections[0].orientation, 'portrait')
})

test('a break can turn the paper back', () => {
  const sections = resolveSections(
    [
      { id: 'aaaa', pos: 12, orientation: 'landscape' },
      { id: 'bbbb', pos: 40, orientation: 'portrait' },
    ],
    page,
  )
  assert.deepEqual(
    sections.map((s) => s.orientation),
    ['portrait', 'landscape', 'portrait'],
  )
})

test('margins and size inherit independently', () => {
  const sections = resolveSections(
    [
      { id: 'aaaa', pos: 12, margin: { top: 5, right: 5, bottom: 5, left: 5 } },
      { id: 'bbbb', pos: 40, size: { label: 'A5', width: 14.8, height: 21 } },
    ],
    page,
  )
  // The second break changed only the size, so it keeps the wide margins the first one set.
  assert.deepEqual(sections[2].margin, { top: 5, right: 5, bottom: 5, left: 5 })
  assert.equal(sections[2].size.width, 14.8)
  // And the first section is untouched by either.
  assert.deepEqual(sections[0].margin, margin)
})

test('every section names the breaks it runs between', () => {
  const sections = resolveSections(
    [
      { id: 'aaaa', pos: 12 },
      { id: 'bbbb', pos: 40 },
    ],
    page,
  )
  assert.deepEqual(
    sections.map((s) => [s.openedBy, s.closedBy]),
    [
      [null, 'aaaa'],
      ['aaaa', 'bbbb'],
      ['bbbb', null],
    ],
  )
})

test('an unreadable geometry is inherited rather than drawn', () => {
  // A width of zero is not a page, and refusing to draw is better than drawing nothing.
  const sections = resolveSections(
    [
      {
        id: 'aaaa',
        pos: 12,
        size: { width: 0, height: 10 },
        orientation: 'sideways',
      },
    ],
    page,
  )
  assert.deepEqual(sections[1].size, a4)
  assert.equal(sections[1].orientation, 'portrait')
})

test('a margin is taken whole or not at all', () => {
  assert.equal(normalizeSectionMargin({ top: 1, right: 1, bottom: 1 }), null)
  assert.deepEqual(
    normalizeSectionMargin({ top: 1, right: 2, bottom: 3, left: 4 }),
    {
      top: 1,
      right: 2,
      bottom: 3,
      left: 4,
    },
  )
  assert.equal(normalizeSectionSize({ width: 21 }), null)
})

test('landscape swaps the sheet, not the paper', () => {
  assert.deepEqual(sheetSizeOf({ size: a4, orientation: 'landscape' }), {
    width: 29.7,
    height: 21,
  })
  assert.deepEqual(sheetSizeOf({ size: a4, orientation: 'portrait' }), {
    width: 21,
    height: 29.7,
  })
})

test('the canvas is as wide as the widest sheet', () => {
  const sections = resolveSections(
    [{ id: 'aaaa', pos: 12, orientation: 'landscape' }],
    page,
  )
  assert.equal(widestSheet(sections), 29.7)
})

test('a position belongs to the last section that started before it', () => {
  const sections = resolveSections(
    [
      { id: 'aaaa', pos: 12 },
      { id: 'bbbb', pos: 40 },
    ],
    page,
  )
  assert.equal(sectionIndexAt(sections, 0), 0)
  assert.equal(sectionIndexAt(sections, 11), 0)
  // A break opens its section, so the break's own position is already in it.
  assert.equal(sectionIndexAt(sections, 12), 1)
  assert.equal(sectionIndexAt(sections, 39), 1)
  assert.equal(sectionIndexAt(sections, 400), 2)
})

test('two sections drawn the same way compare equal', () => {
  const sections = resolveSections(
    [
      { id: 'aaaa', pos: 12 },
      { id: 'bbbb', pos: 40, orientation: 'landscape' },
    ],
    page,
  )
  assert.equal(sameGeometry(sections[0], sections[1]), true)
  assert.equal(sameGeometry(sections[1], sections[2]), false)
})
