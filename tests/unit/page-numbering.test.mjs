import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyPageTemplate,
  computePageNumbers,
  defaultPageNumberSettings,
} from '../../src/utils/page-numbering.js'

const texts = (result) => result.map((r) => (r.visible ? r.text : null))

test('numbering is off until asked for', () => {
  const out = computePageNumbers(3, defaultPageNumberSettings(), [])
  assert.deepEqual(texts(out), [null, null, null])
  // The values are still computed, so switching it on does not renumber anything.
  assert.deepEqual(out.map((r) => r.value), [1, 2, 3])
})

test('an empty document produces nothing', () => {
  assert.deepEqual(computePageNumbers(0, { enabled: true }, []), [])
})

test('a plain sequence starts at one', () => {
  const out = computePageNumbers(4, { enabled: true }, [])
  assert.deepEqual(texts(out), ['1', '2', '3', '4'])
})

test('the document can start at any number', () => {
  // "mulai dari 10 di halaman pertama"
  const out = computePageNumbers(3, { enabled: true, startAt: 10 }, [])
  assert.deepEqual(texts(out), ['10', '11', '12'])
})

test('a section restarts the count where it opens', () => {
  // "reset ke halaman 1 setelah halaman ke 5"
  const out = computePageNumbers(8, { enabled: true }, [{ atSheet: 5, startAt: 1 }])
  assert.deepEqual(texts(out), ['1', '2', '3', '4', '5', '1', '2', '3'])
})

test('a section can restart and change the numeral system at once', () => {
  // "reset ke 1 di halaman ke 5 dan ganti ke bilangan romawi"
  const out = computePageNumbers(7, { enabled: true }, [
    { atSheet: 4, startAt: 1, format: 'roman-lower' },
  ])
  assert.deepEqual(texts(out), ['1', '2', '3', '4', 'i', 'ii', 'iii'])
})

test('the thesis shape: roman front matter, then the body restarts at one', () => {
  const out = computePageNumbers(6, { enabled: true, format: 'roman-lower' }, [
    { atSheet: 2, startAt: 1, format: 'numeric' },
  ])
  assert.deepEqual(texts(out), ['i', 'ii', '1', '2', '3', '4'])
})

test('a section that changes only the format keeps the running count', () => {
  const out = computePageNumbers(5, { enabled: true }, [{ atSheet: 3, format: 'roman-upper' }])
  assert.deepEqual(texts(out), ['1', '2', '3', 'IV', 'V'])
})

test('a section can hide numbers and a later one can bring them back', () => {
  const out = computePageNumbers(6, { enabled: true }, [
    { atSheet: 2, enabled: false },
    { atSheet: 4, enabled: true },
  ])
  assert.deepEqual(texts(out), ['1', '2', null, null, '5', '6'])
  // Hidden pages still consume a number, the way a word processor counts them.
  assert.deepEqual(out.map((r) => r.value), [1, 2, 3, 4, 5, 6])
})

test('position is inherited until a section changes it', () => {
  const out = computePageNumbers(4, { enabled: true, position: 'bottom-center' }, [
    { atSheet: 2, position: 'top-right' },
  ])
  assert.deepEqual(out.map((r) => r.position), [
    'bottom-center', 'bottom-center', 'top-right', 'top-right',
  ])
})

test('a template can carry words and the total', () => {
  const out = computePageNumbers(3, { enabled: true, template: 'Halaman {number} dari {total}' }, [])
  assert.deepEqual(texts(out), ['Halaman 1 dari 3', 'Halaman 2 dari 3', 'Halaman 3 dari 3'])
  assert.equal(applyPageTemplate('{number}/{total}', 'iv', 9), 'iv/9')
})

test('the total is the sheet count, not the last printed number', () => {
  const out = computePageNumbers(5, { enabled: true, startAt: 10, template: '{number} of {total}' }, [])
  assert.equal(out[0].text, '10 of 5')
})

test('a section outside the document is ignored rather than throwing', () => {
  const out = computePageNumbers(3, { enabled: true }, [
    { atSheet: 0, startAt: 99 },
    { atSheet: 9, startAt: 50 },
    { atSheet: -1, startAt: 7 },
    null,
  ])
  assert.deepEqual(texts(out), ['1', '2', '3'])
})

test('an unknown format or position falls back instead of rendering nothing', () => {
  const out = computePageNumbers(2, { enabled: true, format: 'klingon', position: 'middle-of-nowhere' }, [])
  assert.deepEqual(texts(out), ['1', '2'])
  assert.equal(out[0].position, 'bottom-center')
})

test('two sections on the same sheet: the last one wins, and nothing is double counted', () => {
  const out = computePageNumbers(4, { enabled: true }, [
    { atSheet: 2, startAt: 20 },
    { atSheet: 2, startAt: 30 },
  ])
  assert.deepEqual(texts(out), ['1', '2', '30', '31'])
})

test('the physical page index is never restarted, whatever the footer shows', () => {
  // A PDF outline and the reader's page navigation use the physical page. A thesis whose body
  // restarts at 1 still has its "BAB I" bookmark pointing at physical page 3 here.
  const out = computePageNumbers(6, { enabled: true, format: 'roman-lower' }, [
    { atSheet: 2, startAt: 1, format: 'numeric' },
  ])
  assert.deepEqual(out.map((r) => r.index), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(texts(out), ['i', 'ii', '1', '2', '3', '4'])
})

test('hiding the footer number leaves the physical index intact', () => {
  const out = computePageNumbers(4, { enabled: true }, [{ atSheet: 1, enabled: false }])
  assert.deepEqual(out.map((r) => r.index), [1, 2, 3, 4])
  assert.deepEqual(texts(out), ['1', null, null, null])
})

test('starting the footer count at ten does not move any physical page', () => {
  const out = computePageNumbers(3, { enabled: true, startAt: 10 }, [])
  assert.deepEqual(out.map((r) => r.index), [1, 2, 3])
  assert.deepEqual(texts(out), ['10', '11', '12'])
})

test('a page break with no section set does not renumber anything', () => {
  // This is what a plain page break sends: every field null, because the user set none of them.
  // `Number(null)` is 0, so an earlier version restarted the count at zero on every chapter break.
  const plain = { atSheet: 2, enabled: null, position: null, format: null, template: null, startAt: null }
  const out = computePageNumbers(4, { enabled: true }, [plain])
  assert.deepEqual(texts(out), ['1', '2', '3', '4'])
})

test('an empty start value is not a restart either', () => {
  const out = computePageNumbers(4, { enabled: true }, [{ atSheet: 2, startAt: '' }])
  assert.deepEqual(texts(out), ['1', '2', '3', '4'])
})

test('several plain breaks in a row leave one running sequence', () => {
  // The thesis case: a break at every chapter, none of them meant to restart anything.
  const breaks = [1, 2, 3, 4].map((atSheet) => ({ atSheet, startAt: null }))
  const out = computePageNumbers(6, { enabled: true }, breaks)
  assert.deepEqual(texts(out), ['1', '2', '3', '4', '5', '6'])
})

test('one break can restart while the plain ones around it carry on', () => {
  const out = computePageNumbers(6, { enabled: true }, [
    { atSheet: 1, startAt: null },
    { atSheet: 2, startAt: 1, format: 'numeric' },
    { atSheet: 4, startAt: null },
  ])
  assert.deepEqual(texts(out), ['1', '2', '1', '2', '3', '4'])
})

test('restarting at zero is still possible when asked for explicitly', () => {
  const out = computePageNumbers(3, { enabled: true }, [{ atSheet: 1, startAt: 0 }])
  assert.deepEqual(out.map((r) => r.value), [1, 0, 1])
})

test('the page that opens a chapter can carry its number somewhere else', () => {
  // The thesis convention: bottom centre where a chapter starts, top right on the pages that follow.
  const out = computePageNumbers(
    5,
    { enabled: true, position: 'top-right', firstPagePosition: 'bottom-center' },
    [{ atSheet: 3, startAt: null }],
  )
  assert.deepEqual(out.map((r) => r.position), [
    'bottom-center', 'top-right', 'top-right', 'bottom-center', 'top-right',
  ])
})

test('a page break opens a chapter even when it changes nothing about the count', () => {
  const out = computePageNumbers(
    4,
    { enabled: true, position: 'top-right', firstPagePosition: 'bottom-center' },
    [{ atSheet: 2, enabled: null, position: null, format: null, template: null, startAt: null }],
  )
  assert.deepEqual(out.map((r) => r.opensSection), [true, false, true, false])
  assert.deepEqual(texts(out), ['1', '2', '3', '4'])
})

test('without a separate first-page position every page uses the same one', () => {
  const out = computePageNumbers(3, { enabled: true, position: 'top-right' }, [])
  assert.deepEqual(out.map((r) => r.position), ['top-right', 'top-right', 'top-right'])
})

test('a section can change where the number sits, not only how it counts', () => {
  // The engine resolved this from the start; the panel simply never offered it. Asserted here so
  // that stays true.
  const pages = computePageNumbers(
    4,
    { enabled: true, position: 'bottom-center', format: 'numeric', startAt: 1, template: '{number}' },
    [{ atSheet: 2, position: 'top-right' }],
  )
  assert.deepEqual(pages.map((p) => p.position), [
    'bottom-center', 'bottom-center', 'top-right', 'top-right',
  ])
  // Changing only the position leaves the running count alone.
  assert.deepEqual(pages.map((p) => p.text), ['1', '2', '3', '4'])
})

test('a section can put its own number somewhere else on the page it opens', () => {
  const pages = computePageNumbers(
    4,
    { enabled: true, position: 'top-right', format: 'numeric', startAt: 1, template: '{number}' },
    [{ atSheet: 2, firstPagePosition: 'bottom-center' }],
  )
  // The thesis convention: a folio at the foot of a chapter's opening page, at the head elsewhere.
  assert.deepEqual(pages.map((p) => p.position), [
    'top-right', 'top-right', 'bottom-center', 'top-right',
  ])
})

test('a section can carry its own template', () => {
  const pages = computePageNumbers(
    4,
    { enabled: true, position: 'bottom-center', format: 'numeric', startAt: 1, template: '{number}' },
    [{ atSheet: 2, template: 'Halaman {number} dari {total}' }],
  )
  assert.deepEqual(pages.map((p) => p.text), [
    '1', '2', 'Halaman 3 dari 4', 'Halaman 4 dari 4',
  ])
})

test('an empty template prints nothing and the count carries on underneath', () => {
  // Asked for by name. The pages in the section show no number at all, and the pages after it come
  // back with the numbers they would have had - so this hides a folio rather than resetting a count.
  const pages = computePageNumbers(
    6,
    { enabled: true, position: 'bottom-center', format: 'numeric', startAt: 1, template: '{number}' },
    [{ atSheet: 1, template: '' }, { atSheet: 3, template: '{number}' }],
  )
  assert.deepEqual(pages.map((p) => p.text), ['1', '', '', '4', '5', '6'])
  // The count itself never stopped: the physical page and the visible number stay in step.
  assert.deepEqual(pages.map((p) => p.index), [1, 2, 3, 4, 5, 6])
})

test('a section that says nothing changes nothing', () => {
  const withSection = computePageNumbers(
    3,
    { enabled: true, position: 'bottom-center', format: 'numeric', startAt: 1, template: '{number}' },
    [{ atSheet: 1 }],
  )
  const without = computePageNumbers(
    3,
    { enabled: true, position: 'bottom-center', format: 'numeric', startAt: 1, template: '{number}' },
    [],
  )
  assert.deepEqual(
    withSection.map((p) => [p.text, p.position]),
    without.map((p) => [p.text, p.position]),
  )
})

test('the document template is free text, and empty means no number anywhere', () => {
  // The same freedom as a section, asked for by name: whatever the writer types is what is printed,
  // and nothing at all is a legitimate answer.
  const free = computePageNumbers(
    3,
    { enabled: true, position: 'bottom-center', format: 'roman-lower', startAt: 1, template: '- {number} -' },
  )
  assert.deepEqual(free.map((p) => p.text), ['- i -', '- ii -', '- iii -'])

  const silent = computePageNumbers(
    3,
    { enabled: true, position: 'bottom-center', format: 'numeric', startAt: 1, template: '' },
  )
  assert.deepEqual(silent.map((p) => p.text), ['', '', ''])
  // The physical page is a fact about the document, so it is still counted and still published for
  // the contents and for PDF navigation.
  assert.deepEqual(silent.map((p) => p.index), [1, 2, 3])
})
