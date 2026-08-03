import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DocumentFileError,
  createDocumentSnapshot,
  findBlobUrls,
  getDocumentFileName,
  parseDocumentFile,
  serializeDocumentSnapshot,
} from '../../src/utils/document-file.js'

const createFixture = () => ({
  content: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Project Plan' }],
      },
    ],
  },
  document: {
    title: 'Project Plan',
    content: '<h1>must not be serialized</h1>',
  },
  page: {
    layout: 'page',
    size: { label: 'A4', width: 21, height: 29.7, default: true },
    margin: { left: 3.18, right: 3.18, top: 2.54, bottom: 2.54 },
    orientation: 'portrait',
    background: '#ffffff',
    watermark: {
      type: 'compact',
      alpha: 0.2,
      fontColor: '#000000',
      fontSize: 16,
      fontFamily: 'SimSun',
      fontWeight: 'normal',
      text: '',
    },
    showBreakMarks: true,
    showLineNumber: false,
    showBookmark: false,
    showToc: false,
    zoomLevel: 125,
    preview: { enabled: true },
  },
  editorVersion: '11.0.4',
  savedAt: '2026-07-28T10:00:00.000Z',
})

test('creates a portable snapshot with only supported document and page fields', () => {
  const snapshot = createDocumentSnapshot(createFixture())

  assert.equal(snapshot.format, 'umodoc')
  assert.equal(snapshot.formatVersion, 1)
  assert.deepEqual(snapshot.document, { title: 'Project Plan' })
  assert.equal(snapshot.page.size.default, undefined)
  assert.equal(snapshot.page.zoomLevel, undefined)
  assert.equal(snapshot.page.preview, undefined)
})

test('serializes and parses the snapshot without changing its data', () => {
  const snapshot = createDocumentSnapshot(createFixture())
  const parsed = parseDocumentFile(serializeDocumentSnapshot(snapshot))

  assert.deepEqual(parsed, snapshot)
})

test('preserves block style profiles in document snapshots', () => {
  const fixture = createFixture()
  fixture.profiles = [
    { id: 'profile-h1', name: 'Title 1', enabled: true, style: 'roman-upper', template: 'BAB {number}' },
  ]
  const snapshot = createDocumentSnapshot(fixture)
  const parsed = parseDocumentFile(serializeDocumentSnapshot(snapshot))

  assert.deepEqual(parsed.profiles, fixture.profiles)
})

test('rejects malformed JSON, unknown formats, and unsupported versions', () => {
  assert.throws(
    () => parseDocumentFile('{'),
    (error) =>
      error instanceof DocumentFileError && error.code === 'invalidJson',
  )

  const snapshot = createDocumentSnapshot(createFixture())
  assert.throws(
    () => parseDocumentFile(JSON.stringify({ ...snapshot, format: 'other' })),
    (error) => error.code === 'unknownFormat',
  )
  assert.throws(
    () =>
      parseDocumentFile(JSON.stringify({ ...snapshot, formatVersion: 999 })),
    (error) => error.code === 'unsupportedVersion',
  )
})

test('rejects invalid page fields before returning a snapshot', () => {
  const fixture = createFixture()
  fixture.page.margin.left = -1

  assert.throws(
    () => createDocumentSnapshot(fixture),
    (error) => error.code === 'invalidFile',
  )

  const invalidAlpha = createFixture()
  invalidAlpha.page.watermark.alpha = 1.1
  assert.throws(
    () => createDocumentSnapshot(invalidAlpha),
    (error) => error.code === 'invalidFile',
  )
})

test('finds distinct non-portable blob URLs at any content depth', () => {
  const content = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { src: 'blob:https://editor.test/one' } },
      {
        type: 'file',
        attrs: {
          url: 'blob:https://editor.test/one',
          preview: 'blob:https://editor.test/two',
        },
      },
      { type: 'image', attrs: { src: 'https://example.com/image.png' } },
    ],
  }

  assert.deepEqual(findBlobUrls(content), [
    'blob:https://editor.test/one',
    'blob:https://editor.test/two',
  ])
})

test('creates safe and identifiable JSON file names', () => {
  assert.equal(
    getDocumentFileName('Quarter: 1 / Plan'),
    'Quarter- 1 - Plan.umodoc.json',
  )
  assert.equal(
    getDocumentFileName('Project.umodoc.json'),
    'Project.umodoc.json',
  )
  assert.equal(getDocumentFileName(''), 'Untitled Document.umodoc.json')
  assert.equal(getDocumentFileName('CON'), '_CON.umodoc.json')
})
