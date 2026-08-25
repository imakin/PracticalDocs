import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import {
  extractAssets,
  isArchive,
  packArchive,
  readAsset,
  readDocument,
  sha256,
} from '../../storage-server/archive.js'
import { encryptPayload } from '../../storage-server/crypto-utils.js'

// A real PNG, so the test exercises bytes that must survive untouched rather than ASCII.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR4nGP8z8Dwn4GKgIma' +
    'ho0aOGoggQAAtQEDEbwPjZQAAAAASUVORK5CYII=',
  'base64',
)
const JPEG = crypto.randomBytes(2048)

test('an archive round-trips the document unchanged', () => {
  const doc = { id: 'tesis', title: 'tesis', html: '<p>halo</p>', nested: { a: [1, 2, 3] } }
  const packed = packArchive(doc, [])
  assert.ok(isArchive(packed))
  assert.deepEqual(readDocument(packed).document, doc)
})

test('asset bytes come back byte-identical and are never re-encoded', () => {
  const packed = packArchive({ id: 'x' }, [
    { name: 'gambar1.png', type: 'image/png', data: PNG },
    { name: 'foto.jpg', type: 'image/jpeg', data: JPEG },
  ])
  const first = readAsset(packed, sha256(PNG))
  const second = readAsset(packed, sha256(JPEG))
  assert.ok(first.data.equals(PNG), 'png bytes must be identical')
  assert.ok(second.data.equals(JPEG), 'jpeg bytes must be identical')
  assert.equal(first.type, 'image/png')
  assert.equal(second.name, 'foto.jpg')
})

test('the stored archive does not inflate the image bytes', () => {
  const packed = packArchive({ id: 'x' }, [{ name: 'a.jpg', type: 'image/jpeg', data: JPEG }])
  // base64 would add a third, and the old hex envelope doubled on top of that
  const asBase64Envelope = encryptPayload({ id: 'x', data: JPEG.toString('base64') }).length
  assert.ok(
    packed.length < JPEG.length * 1.2,
    `archive ${packed.length} should stay close to the ${JPEG.length} bytes it holds`,
  )
  assert.ok(
    packed.length < asBase64Envelope / 2,
    `archive ${packed.length} should be far smaller than the ${asBase64Envelope} byte base64 envelope`,
  )
})

test('an asset can be found by name as well as by hash', () => {
  const packed = packArchive({ id: 'x' }, [{ name: 'gambar1.png', type: 'image/png', data: PNG }])
  assert.ok(readAsset(packed, 'gambar1.png').data.equals(PNG))
  assert.equal(readAsset(packed, 'tidak-ada.png'), null)
})

test('identical bytes are addressed by one hash', () => {
  const packed = packArchive({ id: 'x' }, [
    { name: 'satu.png', type: 'image/png', data: PNG },
    { name: 'dua.png', type: 'image/png', data: PNG },
  ])
  const table = readDocument(packed).assets
  assert.equal(table.length, 2)
  assert.equal(table[0].sha256, table[1].sha256)
})

test('existing assets can be listed so a save need not resend them', () => {
  const packed = packArchive({ id: 'x' }, [
    { name: 'gambar1.png', type: 'image/png', data: PNG },
    { name: 'foto.jpg', type: 'image/jpeg', data: JPEG },
  ])
  const map = extractAssets(packed)
  assert.equal(map.size, 2)
  assert.ok(map.get(sha256(PNG)).data.equals(PNG))
})

test('documents written in the old envelope format still load', () => {
  const legacy = Buffer.from(encryptPayload({ id: 'lama', title: 'lama', html: '<p>x</p>' }), 'utf8')
  assert.equal(isArchive(legacy), false)
  const read = readDocument(legacy)
  assert.equal(read.document.title, 'lama')
  assert.deepEqual(read.assets, [])
  assert.equal(read.legacy, true)
})

test('a tampered archive is rejected rather than silently returning garbage', () => {
  const packed = packArchive({ id: 'x' }, [{ name: 'a.png', type: 'image/png', data: PNG }])
  const tampered = Buffer.from(packed)
  tampered[tampered.length - 1] ^= 0xff
  assert.throws(() => readDocument(tampered))
})
