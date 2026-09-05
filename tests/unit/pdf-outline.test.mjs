/**
 * The pure half of writing a PDF outline: the tree, the labels, and what a real PDF comes back as.
 *
 * The fixture is a PDF this test makes itself with pdf-lib, so it needs no browser, no export and no
 * stored document. What it cannot check is what Adobe Reader draws; that is
 * `experiments/0002-pdf-outline-written-in-the-browser.md`, and it is why the outline is also read
 * back out of the bytes here rather than trusted.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { PDFDocument, PDFName } from 'pdf-lib'

import {
  buildOutlineTree,
  countOutlineItems,
  outlineTitle,
  pageLabelRanges,
  writePdfOutline,
} from '../../src/utils/pdf-outline.js'

const entries = [
  { level: 1, number: 'BAB I', title: 'Pendahuluan', page: 1 },
  { level: 2, number: '1.1', title: 'Latar Belakang', page: 1 },
  { level: 2, number: '1.2', title: 'Rumusan Masalah', page: 2 },
  { level: 1, number: 'BAB II', title: 'Tinjauan Pustaka', page: 3 },
  { level: 2, number: '2.1', title: 'Penelitian Terdahulu', page: 3 },
]

const makePdf = async (pageCount) => {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < pageCount; i += 1) pdf.addPage([595, 842])
  return pdf.save()
}

test('a flat list of headings becomes a tree by level', () => {
  const roots = buildOutlineTree(entries)
  assert.equal(roots.length, 2)
  assert.equal(roots[0].children.length, 2)
  assert.equal(roots[1].children.length, 1)
  assert.equal(countOutlineItems(roots), 5)
})

test('a heading deeper than its predecessor becomes its child however big the gap', () => {
  const roots = buildOutlineTree([
    { level: 1, title: 'One', page: 1 },
    { level: 4, title: 'Deep', page: 1 },
    { level: 2, title: 'Back up', page: 2 },
  ])
  assert.equal(roots.length, 1)
  assert.equal(roots[0].children.length, 2)
  assert.equal(roots[0].children[0].title, 'Deep')
})

test('a document that starts below level 1 still has roots', () => {
  const roots = buildOutlineTree([
    { level: 3, title: 'First', page: 1 },
    { level: 3, title: 'Second', page: 2 },
  ])
  assert.equal(roots.length, 2)
})

test('a bookmark reads the number and the title together', () => {
  assert.equal(outlineTitle({ number: 'BAB I', title: 'Pendahuluan' }), 'BAB I Pendahuluan')
  assert.equal(outlineTitle({ number: '', title: 'Kata Pengantar' }), 'Kata Pengantar')
  assert.equal(outlineTitle({ number: '1.1', title: '' }), '1.1')
})

test('consecutive pages counting on in one style are one label range', () => {
  const ranges = pageLabelRanges([
    { index: 1, value: 1, format: 'numeric' },
    { index: 2, value: 2, format: 'numeric' },
    { index: 3, value: 3, format: 'numeric' },
  ])
  assert.deepEqual(ranges, [{ from: 0, style: 'D', start: 1 }])
})

test('roman front matter and a body restarting at one are two ranges', () => {
  const ranges = pageLabelRanges([
    { index: 1, value: 1, format: 'roman-lower' },
    { index: 2, value: 2, format: 'roman-lower' },
    { index: 3, value: 1, format: 'numeric' },
    { index: 4, value: 2, format: 'numeric' },
  ])
  assert.deepEqual(ranges, [
    { from: 0, style: 'r', start: 1 },
    { from: 2, style: 'D', start: 1 },
  ])
})

test('a restart in the same numerals opens a new range', () => {
  const ranges = pageLabelRanges([
    { index: 1, value: 1, format: 'numeric' },
    { index: 2, value: 2, format: 'numeric' },
    { index: 3, value: 1, format: 'numeric' },
  ])
  assert.equal(ranges.length, 2)
  assert.deepEqual(ranges[1], { from: 2, style: 'D', start: 1 })
})

test('every numeral style this editor offers has a PDF style', () => {
  const styles = ['numeric', 'roman-lower', 'roman-upper', 'alpha-lower', 'alpha-upper']
  const ranges = pageLabelRanges(styles.map((format, i) => ({ index: i + 1, value: 1, format })))
  assert.deepEqual(ranges.map((r) => r.style), ['D', 'r', 'R', 'a', 'A'])
})

test('the written outline is really in the bytes, nested and pointing at the right pages', async () => {
  const bytes = await writePdfOutline(await makePdf(4), {
    entries,
    pages: [
      { index: 1, value: 1, format: 'roman-lower' },
      { index: 2, value: 1, format: 'numeric' },
      { index: 3, value: 2, format: 'numeric' },
      { index: 4, value: 3, format: 'numeric' },
    ],
    metadata: { title: 'Tesis', author: 'Penulis' },
  })

  const back = await PDFDocument.load(bytes)
  const outlines = back.catalog.lookup(PDFName.of('Outlines'))
  assert.ok(outlines, 'the catalog has no /Outlines')
  assert.equal(outlines.lookup(PDFName.of('Count')).asNumber(), 5)

  // Walk the chain the way a reader does, rather than trusting the writer's own tree.
  const titles = []
  const walk = (ref) => {
    let current = ref
    while (current) {
      const dict = back.context.lookup(current)
      titles.push(dict.lookup(PDFName.of('Title')).decodeText())
      const first = dict.get(PDFName.of('First'))
      if (first) walk(first)
      current = dict.get(PDFName.of('Next'))
    }
  }
  walk(outlines.get(PDFName.of('First')))
  assert.deepEqual(titles, [
    'BAB I Pendahuluan',
    '1.1 Latar Belakang',
    '1.2 Rumusan Masalah',
    'BAB II Tinjauan Pustaka',
    '2.1 Penelitian Terdahulu',
  ])

  const labels = back.catalog.lookup(PDFName.of('PageLabels'))
  assert.ok(labels, 'the catalog has no /PageLabels')
  const nums = labels.lookup(PDFName.of('Nums'))
  assert.equal(nums.get(0).asNumber(), 0)
  assert.equal(nums.lookup(1).lookup(PDFName.of('S')).asString(), '/r')
  assert.equal(nums.get(2).asNumber(), 1)
  assert.equal(nums.lookup(3).lookup(PDFName.of('S')).asString(), '/D')

  assert.equal(back.getTitle(), 'Tesis')
  assert.equal(back.getAuthor(), 'Penulis')
})

test('a page count that disagrees with the document is refused, not guessed at', async () => {
  const bytes = await makePdf(4)
  await assert.rejects(
    () => writePdfOutline(bytes, { entries, expectedPageCount: 6 }),
    (error) => {
      assert.equal(error.reason, 'page-count-mismatch')
      assert.equal(error.pageCount, 4)
      assert.equal(error.expectedPageCount, 6)
      return true
    },
  )
})

test('a matching page count is accepted', async () => {
  const bytes = await writePdfOutline(await makePdf(4), { entries, expectedPageCount: 4 })
  assert.ok(bytes.length > 0)
})

test('a document with no headings still gets its page labels', async () => {
  const bytes = await writePdfOutline(await makePdf(2), {
    entries: [],
    pages: [{ index: 1, value: 1, format: 'numeric' }, { index: 2, value: 2, format: 'numeric' }],
  })
  const back = await PDFDocument.load(bytes)
  assert.equal(back.catalog.lookup(PDFName.of('Outlines')), undefined)
  assert.ok(back.catalog.lookup(PDFName.of('PageLabels')))
})

test('a bookmark past the last page lands on the last page rather than throwing', async () => {
  const bytes = await writePdfOutline(await makePdf(2), {
    entries: [{ level: 1, title: 'Beyond', page: 99 }],
  })
  const back = await PDFDocument.load(bytes)
  assert.ok(back.catalog.lookup(PDFName.of('Outlines')))
})
