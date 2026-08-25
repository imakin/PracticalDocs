import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ASSETS_PREFIX,
  assetPath,
  assetUrl,
  collectAssets,
  findUnresolvedMedia,
  parseAssetPath,
  resolveAssets,
  safeAssetName,
} from '../../src/utils/document-assets.js'

const BASE = 'http://localhost:3001'
const DOC = 'tesis4'

test('an asset path is a real relative path, not a token', async () => {
  assert.equal(assetPath('gambar1.1.png'), `${ASSETS_PREFIX}gambar1.1.png`)
  assert.equal(parseAssetPath('./assets/gambar1.1.png'), 'gambar1.1.png')
  assert.equal(parseAssetPath('assets/gambar1.1.png'), 'gambar1.1.png')
  assert.equal(parseAssetPath('https://example.test/a.png'), null)
})

test('a name stays recognisable but safe to write to disk', async () => {
  assert.equal(safeAssetName('Gambar 1.1 (final).PNG'), 'Gambar_1.1_final_.PNG')
  assert.equal(safeAssetName('../../etc/passwd'), 'passwd')
  assert.equal(safeAssetName(''), 'asset')
})

test('loading points relative paths at the server the document came from', async () => {
  const snapshot = {
    content: '<figure><img src="./assets/gambar1.1.png"></figure>',
    page: { background: '#fff' },
  }
  const resolved = resolveAssets(snapshot, BASE, DOC)
  assert.equal(
    resolved.content,
    `<figure><img src="${assetUrl(BASE, DOC, 'gambar1.1.png')}"></figure>`,
  )
  assert.equal(resolved.page.background, '#fff')
})

test('saving folds a server url back to the relative path and carries no bytes for it', async () => {
  const url = assetUrl(BASE, DOC, 'gambar1.1.png')
  const packed = await collectAssets({
    json: { type: 'doc', content: [{ type: 'image', attrs: { src: url } }] },
    html: `<figure><img src="${url}" width="10"></figure>`,
  })
  assert.equal(packed.json.content[0].attrs.src, './assets/gambar1.1.png')
  assert.ok(packed.html.includes('src="./assets/gambar1.1.png"'))
  assert.ok(packed.html.includes('width="10"'))
  assert.deepEqual(
    packed.assets.map((a) => ({ name: a.name, hasData: a.data !== undefined })),
    [{ name: 'gambar1.1.png', hasData: false }],
  )
})

test('a document moved to another server still resolves', async () => {
  const moved = resolveAssets({ attrs: { src: './assets/a.png' } }, 'http://192.168.1.9:3001', DOC)
  assert.equal(moved.attrs.src, assetUrl('http://192.168.1.9:3001', DOC, 'a.png'))
})

test('a path that is already relative survives a save unchanged', async () => {
  const packed = await collectAssets({
    json: { attrs: { src: './assets/foto.jpg' } },
    html: '<img src="./assets/foto.jpg">',
  })
  assert.equal(packed.json.attrs.src, './assets/foto.jpg')
  assert.deepEqual(packed.assets.map((a) => a.name), ['foto.jpg'])
})

test('one asset used twice is listed once', async () => {
  const url = assetUrl(BASE, DOC, 'a.png')
  const packed = await collectAssets({
    json: { type: 'doc', content: [{ attrs: { src: url } }, { attrs: { src: url } }] },
  })
  assert.equal(packed.assets.length, 1)
})

test('poster and url attributes are handled like sources', async () => {
  const packed = await collectAssets({
    json: { a: { attrs: { poster: assetUrl(BASE, DOC, 'p.png') } }, b: { attrs: { url: './assets/f.pdf' } } },
  })
  assert.deepEqual(packed.assets.map((a) => a.name).sort(), ['f.pdf', 'p.png'])
  assert.equal(packed.json.a.attrs.poster, './assets/p.png')
})

test('a blob url reaching a save is reported instead of being written', async () => {
  const stranded = findUnresolvedMedia({
    json: { attrs: { src: 'blob:http://localhost:9000/x' } },
  })
  assert.deepEqual(stranded, ['blob:http://localhost:9000/x'])
  assert.deepEqual(findUnresolvedMedia({ json: { attrs: { src: './assets/a.png' } } }), [])
})

test('text that merely mentions assets is left alone', async () => {
  const packed = await collectAssets({
    json: { type: 'text', text: 'lihat folder assets/ untuk gambar' },
    html: '<p>lihat folder assets/ untuk gambar</p>',
  })
  assert.equal(packed.json.text, 'lihat folder assets/ untuk gambar')
  assert.equal(packed.assets.length, 0)
})
