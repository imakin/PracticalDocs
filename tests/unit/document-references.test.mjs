import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReferencePlan,
  formatSingleNumber,
  getCrossReferenceText,
  getNextHeadingNumber,
  getReferenceLabel,
  getReferenceTargetOptionLabel,
  toAlphabet,
  toRoman,
} from '../../src/utils/document-references.js'

test('numbers headings hierarchically and resets deeper levels', () => {
  const counters = [0, 0, 0, 0, 0, 0]
  const numbers = [1, 2, 2, 3, 1, 3].map((level) =>
    getNextHeadingNumber(counters, level),
  )

  assert.deepEqual(numbers, ['1', '1.1', '1.2', '1.2.1', '2', '2.1'])
})

test('omits missing parent levels instead of generating zero segments', () => {
  const counters = [0, 0, 0, 0, 0, 0]

  assert.equal(getNextHeadingNumber(counters, 2), '1')
  assert.equal(getNextHeadingNumber(counters, 3), '1.1')
})

test('converts numbers to Roman and Alphabet formats', () => {
  assert.equal(toRoman(1, true), 'I')
  assert.equal(toRoman(4, true), 'IV')
  assert.equal(toRoman(9, false), 'ix')
  assert.equal(toAlphabet(1, true), 'A')
  assert.equal(toAlphabet(26, true), 'Z')
  assert.equal(toAlphabet(27, false), 'aa')

  assert.equal(formatSingleNumber(4, 'roman-upper'), 'IV')
  assert.equal(formatSingleNumber(3, 'alpha-upper'), 'C')
})

test('supports per-profile styles, templates, and ON/OFF toggles', () => {
  const profiles = [
    {
      id: 'prof-h1',
      name: 'BAB H1',
      enabled: true,
      style: 'roman-upper',
      template: 'BAB {number}',
      targetType: 'heading',
      level: 1,
    },
    {
      id: 'prof-h2',
      name: 'H2 Disabled',
      enabled: false,
      style: 'numeric',
      template: '{number}',
      targetType: 'heading',
      level: 2,
    },
  ]

  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1, title: 'Pendahuluan' },
      { pos: 4, targetType: 'heading', level: 2, title: 'Latar Belakang' },
    ],
    { profiles },
  )

  assert.equal(targets[0].label, 'BAB I')
  assert.equal(targets[1].label, '')
  assert.equal(targets[1].enabled, false)
})

test('supports custom placement templates and styles', () => {
  let generatedId = 0
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1, title: 'Pendahuluan' },
      { pos: 4, targetType: 'figure', title: 'Arsitektur' },
      { pos: 8, targetType: 'table', title: 'Hasil' },
    ],
    {
      createId: () => {
        generatedId += 1
        return `id${generatedId}`
      },
      styles: {
        heading: 'roman-upper',
        figure: 'alpha-upper',
        table: 'numeric',
      },
      templates: {
        heading: 'BAB {number}',
        figure: 'Gambar {number}',
        table: 'Tabel {number}',
      },
    },
  )

  assert.deepEqual(
    targets.map(({ targetType, number, label }) => ({
      targetType,
      number,
      label,
    })),
    [
      { targetType: 'heading', number: 'I', label: 'BAB I' },
      // An image is a container, not a numbered block: the caption that carries a profile is.
      { targetType: 'figure', number: '', label: '' },
      { targetType: 'table', number: '1', label: 'Tabel 1' },
    ],
  )
})

test('preserves explicit newlines in placement templates', () => {
  const { targets } = buildReferencePlan(
    [{ pos: 0, targetType: 'heading', level: 1, title: 'PENDAHULUAN' }],
    {
      profiles: [
        {
          id: 'profile-h1',
          targetType: 'heading',
          level: 1,
          template: 'BAB {number}\n',
          style: 'roman-upper',
        },
      ],
    },
  )

  assert.equal(targets[0].label, 'BAB I\n')
})

test('respects global ON/OFF numbering toggle', () => {
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1, title: 'Introduction' },
      { pos: 4, targetType: 'figure', title: 'Chart' },
    ],
    { enabled: false },
  )

  assert.equal(targets[0].label, '')
  assert.equal(targets[1].label, '')
  assert.equal(
    getCrossReferenceText(targets[0], 'label-title', { missing: 'Unavailable' }),
    'Introduction',
  )
})

test('builds independent heading, figure, table, and citation counters', () => {
  let generatedId = 0
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1, title: 'Introduction' },
      { pos: 4, targetType: 'figure', title: 'Architecture' },
      { pos: 8, targetType: 'table', title: 'Results' },
      { pos: 12, targetType: 'figure', title: 'Deployment' },
      { pos: 16, targetType: 'citation', title: 'Example source' },
      { pos: 20, targetType: 'heading', level: 2, title: 'Details' },
    ],
    {
      createId: () => {
        generatedId += 1
        return `id${generatedId}`
      },
    },
  )

  assert.deepEqual(
    targets.map(({ targetType, number, label }) => ({
      targetType,
      number,
      label,
    })),
    [
      { targetType: 'heading', number: '1', label: '1' },
      { targetType: 'figure', number: '', label: '' },
      { targetType: 'table', number: '1', label: 'Table 1' },
      { targetType: 'figure', number: '', label: '' },
      { targetType: 'citation', number: '1', label: '[1]' },
      { targetType: 'heading', number: '1.1', label: '1.1' },
    ],
  )
})

test('preserves unique IDs and replaces a later duplicate', () => {
  let generatedId = 0
  const { targets, updates } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1, targetId: 'heading-fixed' },
      { pos: 5, targetType: 'figure', targetId: 'figure-fixed' },
      { pos: 10, targetType: 'figure', targetId: 'figure-fixed' },
    ],
    {
      createId: () => {
        generatedId += 1
        return `generated${generatedId}`
      },
    },
  )

  assert.equal(targets[0].targetId, 'heading-fixed')
  assert.equal(targets[1].targetId, 'figure-fixed')
  assert.equal(targets[2].targetId, 'figure-generated1')
  assert.equal(updates[0].idChanged, false)
  assert.equal(updates[2].idChanged, true)
})

test('formats every cross-reference display mode with fallbacks', () => {
  const target = {
    label: 'Figure 2',
    title: 'System architecture',
  }

  assert.equal(getCrossReferenceText(target, 'label'), 'Figure 2')
  assert.equal(getCrossReferenceText(target, 'title'), 'System architecture')
  assert.equal(
    getCrossReferenceText(target, 'label-title'),
    'Figure 2: System architecture',
  )
  assert.equal(
    getCrossReferenceText({ label: 'Table 1', title: '' }, 'title'),
    'Table 1',
  )
  assert.equal(getCrossReferenceText(null), 'Reference unavailable')
})

test('formats citation and target option labels', () => {
  assert.equal(getReferenceLabel('citation', '3'), '[3]')
  assert.equal(
    getReferenceTargetOptionLabel({
      label: 'Section 2',
      title: 'Methods',
    }),
    'Section 2: Methods',
  )
})

test('counts by profile rather than by node type', () => {
  // The caption under a figure is an ordinary paragraph carrying the figure profile. Counting by
  // node type numbered it as the sixth paragraph and rendered "Gambar 6".
  const figureProfile = {
    id: 'profile-figure',
    targetType: 'figure',
    template: 'Gambar {number}',
    style: 'numeric',
    enabled: true,
  }
  const paragraph = (pos, profileId) => ({
    pos,
    targetType: 'paragraph',
    numberingProfileId: profileId,
  })
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1, title: 'Bab' },
      paragraph(4),
      paragraph(8),
      paragraph(12),
      paragraph(16, 'profile-figure'),
      paragraph(20),
      paragraph(24, 'profile-figure'),
    ],
    { createId: () => 'x', profiles: [figureProfile] },
  )
  assert.deepEqual(
    targets.filter((t) => t.numberingProfileId === 'profile-figure').map((t) => t.label),
    ['Gambar 1', 'Gambar 2'],
  )
})

test('numbers relative to the enclosing chapter and restarts on a new one', () => {
  const figureProfile = {
    id: 'profile-figure',
    targetType: 'figure',
    template: 'Gambar {h1}.{number}',
    style: 'numeric',
    enabled: true,
  }
  const caption = (pos) => ({
    pos,
    targetType: 'paragraph',
    numberingProfileId: 'profile-figure',
  })
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1 },
      caption(4),
      caption(8),
      { pos: 12, targetType: 'heading', level: 1 },
      caption(16),
      { pos: 20, targetType: 'heading', level: 2 },
      caption(24),
    ],
    { createId: () => 'x', profiles: [figureProfile] },
  )
  assert.deepEqual(
    targets.filter((t) => t.numberingProfileId === 'profile-figure').map((t) => t.label),
    ['Gambar 1.1', 'Gambar 1.2', 'Gambar 2.1', 'Gambar 2.2'],
  )
})

test('a chapter shown in roman still counts as a plain number in templates', () => {
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1 },
      { pos: 4, targetType: 'paragraph', numberingProfileId: 'p' },
    ],
    {
      createId: () => 'x',
      profiles: [
        { id: 'h1', targetType: 'heading', level: 1, style: 'roman-upper', template: 'BAB {number}', enabled: true },
        { id: 'p', targetType: 'paragraph', style: 'numeric', template: 'Gambar {h1}.{number}', enabled: true },
      ],
    },
  )
  assert.equal(targets[0].label, 'BAB I')
  assert.equal(targets[1].label, 'Gambar 1.1')
})

test('a template without any heading placeholder keeps one running sequence', () => {
  const flat = { id: 'flat', targetType: 'paragraph', template: 'Gambar {number}', style: 'numeric', enabled: true }
  const caption = (pos) => ({ pos, targetType: 'paragraph', numberingProfileId: 'flat' })
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1 },
      caption(4),
      { pos: 8, targetType: 'heading', level: 1 },
      caption(12),
    ],
    { createId: () => 'x', profiles: [flat] },
  )
  assert.deepEqual(
    targets.filter((t) => t.numberingProfileId === 'flat').map((t) => t.label),
    ['Gambar 1', 'Gambar 2'],
  )
})
