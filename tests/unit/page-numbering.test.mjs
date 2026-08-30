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
