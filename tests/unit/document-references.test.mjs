import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyTemplate,
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
      // Neither an image nor a table is a numbered block. Both are containers, and what carries the
      // number is the caption the writer wrote and gave a profile to. A heading is different
      // because a heading *is* the thing being numbered.
      { targetType: 'figure', number: '', label: '' },
      { targetType: 'table', number: '', label: '' },
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

test('builds independent heading and citation counters, and numbers no container', () => {
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
      { targetType: 'table', number: '', label: '' },
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

test('a heading whose profile does not number it consumes no number', () => {
  // The user's case: a Title 1 profile without numbering, then a numbered Title 1 after it. The
  // second used to come out as 2, because the unnumbered one had already taken 1.
  const profiles = [
    { id: 'plain-h1', name: 'Title 1 plain', enabled: false, template: '', targetType: 'heading', level: 1 },
    { id: 'numbered-h1', name: 'Title 1', enabled: true, style: 'numeric', template: 'BAB {number}', targetType: 'heading', level: 1 },
  ]
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1, numberingProfileId: 'plain-h1', title: 'Abstract' },
      { pos: 10, targetType: 'heading', level: 1, numberingProfileId: 'numbered-h1', title: 'Pendahuluan' },
      { pos: 20, targetType: 'heading', level: 1, numberingProfileId: 'numbered-h1', title: 'Tinjauan' },
    ],
    { createId: () => 'id', profiles },
  )
  assert.deepEqual(targets.map((t) => t.label), ['', 'BAB 1', 'BAB 2'])
})

test('an unnumbered heading does not restart the levels below it either', () => {
  const profiles = [
    { id: 'plain-h1', enabled: false, template: '', targetType: 'heading', level: 1 },
    { id: 'h2', enabled: true, style: 'numeric', template: '{number}', targetType: 'heading', level: 2 },
  ]
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 2, numberingProfileId: 'h2' },
      { pos: 10, targetType: 'heading', level: 1, numberingProfileId: 'plain-h1' },
      { pos: 20, targetType: 'heading', level: 2, numberingProfileId: 'h2' },
    ],
    { createId: () => 'id', profiles },
  )
  assert.deepEqual(targets.map((t) => t.label), ['1', '', '2'])
})

test('a profile numbering a block without showing a label is allowed', () => {
  // Counted but invisible: the template is empty on purpose, so nothing is drawn, but the block still
  // takes its place in the sequence and a cross reference can still point at it.
  const profiles = [
    { id: 'silent', enabled: true, style: 'numeric', template: '', targetType: 'heading', level: 1 },
  ]
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1, numberingProfileId: 'silent' },
      { pos: 10, targetType: 'heading', level: 1, numberingProfileId: 'silent' },
    ],
    { createId: () => 'id', profiles },
  )
  assert.deepEqual(targets.map((t) => t.label), ['', ''])
  assert.deepEqual(targets.map((t) => t.number), ['1', '2'])
})

test('a template with words but no number shows just the words', () => {
  const profiles = [
    { id: 'named', enabled: true, style: 'numeric', template: 'Lampiran', targetType: 'heading', level: 1 },
  ]
  const { targets } = buildReferencePlan(
    [{ pos: 0, targetType: 'heading', level: 1, numberingProfileId: 'named' }],
    { createId: () => 'id', profiles },
  )
  assert.equal(targets[0].label, 'Lampiran')
})

test("a stale template on the node no longer overrides the profile's", () => {
  const profiles = [
    { id: 'h1', enabled: true, style: 'numeric', template: '', targetType: 'heading', level: 1 },
  ]
  const { targets } = buildReferencePlan(
    [
      {
        pos: 0, targetType: 'heading', level: 1, numberingProfileId: 'h1',
        numberTemplate: 'BAB {number}',
      },
    ],
    { createId: () => 'id', profiles },
  )
  assert.equal(targets[0].label, '')
})

test('applyTemplate tells an empty template apart from no template', () => {
  assert.equal(applyTemplate('', '3', 'Section'), '')
  assert.equal(applyTemplate(null, '3', 'Section'), 'Section 3')
  assert.equal(applyTemplate(undefined, '3', 'Section'), 'Section 3')
  assert.equal(applyTemplate('Bagian {number}', '3', 'Section'), 'Bagian 3')
})

test('a block keeps its profile when that profile is not in the list', () => {
  // A list that is momentarily incomplete - a document still loading, a profile just removed - used
  // to move the block onto the default for its type, and that reassignment was written to the node
  // and could not be undone.
  const profiles = [
    { id: 'h1', enabled: true, style: 'numeric', template: 'BAB {number}', targetType: 'heading', level: 1 },
  ]
  const { targets } = buildReferencePlan(
    [{ pos: 0, targetType: 'heading', level: 1, numberingProfileId: 'custom-h1' }],
    { createId: () => 'id', profiles },
  )
  assert.equal(targets[0].numberingProfileId, 'custom-h1')
  assert.equal(targets[0].label, '')
})

test('the plan never writes into a profile', () => {
  // The profiles are the stylesheet. Filling a profile's empty fields from whichever block happened
  // to be scanned first gave that one block's font and alignment to every block on the profile.
  const profile = {
    id: 'h1', enabled: true, style: 'numeric', template: '{number}',
    targetType: 'heading', level: 1,
  }
  const before = JSON.stringify(profile)
  buildReferencePlan(
    [
      {
        pos: 0, targetType: 'heading', level: 1, numberingProfileId: 'h1',
        fontFamily: 'Arial', fontSize: '20pt', fontWeight: 'bold',
        lineHeight: '2', marginTop: '3em', marginBottom: '4em',
        indent: 5, textAlign: 'center',
      },
    ],
    { createId: () => 'id', profiles: [profile] },
  )
  assert.equal(JSON.stringify(profile), before)
})

test('a block with no profile still follows the default for its type', () => {
  const profiles = [
    { id: 'p', enabled: false, template: '', targetType: 'paragraph' },
    { id: 'h1', enabled: true, style: 'numeric', template: 'BAB {number}', targetType: 'heading', level: 1 },
  ]
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1 },
      { pos: 10, targetType: 'paragraph' },
    ],
    { createId: () => 'id', profiles },
  )
  assert.deepEqual(targets.map((t) => t.numberingProfileId), ['h1', 'p'])
  assert.deepEqual(targets.map((t) => t.label), ['BAB 1', ''])
})

test('a heading inside a table takes no number and consumes none', () => {
  // The writer styles the cells of a literature review with a profile of their own. A profile
  // carrying a heading level turns the block into a heading, so the cells arrived here as headings
  // and spent a section number each - the chapter after a three column table came out as 2.10
  // rather than 3. A heading in a table is a styled cell, not a section.
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1, title: 'Pendahuluan' },
      { pos: 10, targetType: 'heading', level: 1, title: 'Tinjauan Pustaka' },
      { pos: 20, targetType: 'heading', level: 3, title: 'No', inTable: true },
      { pos: 24, targetType: 'heading', level: 3, title: 'Penulis', inTable: true },
      { pos: 28, targetType: 'heading', level: 3, title: 'Kontribusi', inTable: true },
      { pos: 40, targetType: 'heading', level: 1, title: 'Metodologi' },
    ],
    {},
  )

  assert.deepEqual(
    targets.map((target) => target.number),
    ['1', '2', '', '', '', '3'],
  )
})

test('a heading in a table leaves the deeper levels of the count alone', () => {
  // Not just "no number of its own": a level 3 cell must not open a sub-section either, or the
  // first real sub-heading after the table carries on from the cells.
  const { targets } = buildReferencePlan(
    [
      { pos: 0, targetType: 'heading', level: 1, title: 'Tinjauan' },
      { pos: 10, targetType: 'heading', level: 2, title: 'Kajian Terdahulu' },
      { pos: 20, targetType: 'heading', level: 3, title: 'No', inTable: true },
      { pos: 24, targetType: 'heading', level: 3, title: 'Penulis', inTable: true },
      { pos: 30, targetType: 'heading', level: 3, title: 'Sintesis' },
    ],
    {},
  )

  assert.deepEqual(
    targets.map((target) => target.number),
    ['1', '1.1', '', '', '1.1.1'],
  )
})
