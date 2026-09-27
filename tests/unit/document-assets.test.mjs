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
  serverBaseUrl,
} from '../../src/utils/document-assets.js'

const BASE = 'http://localhost:3001'
const DOC = 'tesis4'
const SAVE_URL = `${BASE}/api/documents/save`

// No test reaches a real server. Every fetch is recorded and answered here: a url in FETCHABLE gets
// bytes, anything else a 404. Before this stub, a test with no destination fetched from whatever
// storage server happened to be running on the machine, and its result depended on that.
const FETCHABLE = new Map()
const fetched = []
globalThis.fetch = async (url) => {
  fetched.push(String(url))
  const bytes = FETCHABLE.get(String(url))
  return bytes
    ? new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } })
    : new Response('', { status: 404 })
}
const resetFetch = () => {
  FETCHABLE.clear()
  fetched.length = 0
}

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
  resetFetch()
  const url = assetUrl(BASE, DOC, 'gambar1.1.png')
  // Saved back where it came from: same server, same folder.
  const packed = await collectAssets(
    {
      json: { type: 'doc', content: [{ type: 'image', attrs: { src: url } }] },
      html: `<figure><img src="${url}" width="10"></figure>`,
    },
    { documentId: DOC, serverUrl: SAVE_URL },
  )
  assert.equal(packed.json.content[0].attrs.src, './assets/gambar1.1.png')
  assert.ok(packed.html.includes('src="./assets/gambar1.1.png"'))
  assert.ok(packed.html.includes('width="10"'))
  assert.deepEqual(
    packed.assets.map((a) => ({ name: a.name, hasData: a.data !== undefined })),
    [{ name: 'gambar1.1.png', hasData: false }],
  )
  assert.deepEqual(fetched, [], 'an image already in the folder being written was fetched')
})

test('saving to another server under the same name carries the bytes', async () => {
  // Reported by the writer: opened from server A, saved to server B under the same name, and
  // "Saved, but 15 image(s) could not be stored". The document ids matched, so only names were sent.
  resetFetch()
  const url = assetUrl(BASE, DOC, 'gambar1.1.png')
  FETCHABLE.set(url, new Uint8Array([137, 80, 78, 71]))
  const packed = await collectAssets(
    { json: { attrs: { src: url } }, html: `<img src="${url}">` },
    { documentId: DOC, serverUrl: 'http://192.168.1.9:3001/api/documents/save' },
  )
  assert.deepEqual(fetched, [url])
  assert.equal(packed.assets.length, 1)
  assert.equal(packed.assets[0].name, 'gambar1.1.png')
  assert.equal(packed.assets[0].data, Buffer.from([137, 80, 78, 71]).toString('base64'))
  assert.equal(packed.json.attrs.src, './assets/gambar1.1.png')
})

test('the same server written differently is still the same server', async () => {
  resetFetch()
  const url = assetUrl('http://LocalHost:3001', DOC, 'a.png')
  await collectAssets(
    { json: { attrs: { src: url } } },
    { documentId: DOC, serverUrl: 'http://localhost:3001/api/documents/save/' },
  )
  assert.deepEqual(fetched, [])
})

test('with no destination known, the bytes are carried rather than assumed', async () => {
  resetFetch()
  const url = assetUrl(BASE, DOC, 'a.png')
  FETCHABLE.set(url, new Uint8Array([1, 2, 3]))
  const packed = await collectAssets({ json: { attrs: { src: url } } })
  assert.deepEqual(fetched, [url])
  assert.ok(packed.assets[0].data)
})

test('the Open dialog and the save derive one server from the Server API URL', () => {
  assert.equal(serverBaseUrl(SAVE_URL), BASE)
  assert.equal(serverBaseUrl(`${SAVE_URL}/`), BASE)
  assert.equal(serverBaseUrl('https://doc.example.test/sub/api/documents/save'), 'https://doc.example.test/sub')
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
