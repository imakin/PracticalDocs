import assert from 'node:assert/strict'
import test from 'node:test'

import { formatHtml } from '../../storage-server/format-html.js'

test('block elements are laid out one per line', () => {
  const out = formatHtml('<h1>Judul</h1><p>Satu.</p><p>Dua.</p>')
  assert.equal(out, '<h1>\n  Judul\n</h1>\n<p>\n  Satu.\n</p>\n<p>\n  Dua.\n</p>\n')
})

test('nesting is indented', () => {
  const out = formatHtml('<ul><li>satu</li><li>dua</li></ul>')
  assert.ok(out.includes('\n  <li>'), out)
  assert.ok(out.split('\n').some((line) => line.startsWith('    satu')), out)
})

test('inline markup is never broken apart', () => {
  // Splitting inside a paragraph would insert whitespace into the text the reader sees.
  const out = formatHtml('<p>halo <b>tebal</b> dan <i>miring</i> selesai</p>')
  assert.ok(out.includes('halo <b>tebal</b> dan <i>miring</i> selesai'), out)
})

test('every character inside a code block is left alone', () => {
  const code = '<pre><code class="language-python">def f():\n    return  1\n</code></pre>'
  const out = formatHtml(`<p>x</p>${code}`)
  assert.ok(out.includes('def f():\n    return  1\n'), out)
})

test('attributes containing newlines survive', () => {
  // The numbering template for a chapter heading is literally "BAB {number}\n".
  const html = '<h1 data-number-template="BAB {number}\n">Judul</h1>'
  assert.ok(formatHtml(html).includes('data-number-template="BAB {number}\n"'))
})

test('void elements do not open a level of indentation', () => {
  const out = formatHtml('<p>satu<br>dua</p><hr><p>tiga</p>')
  assert.ok(out.includes('satu<br>dua'), out)
  assert.ok(!out.includes('    <p>\n    tiga'), out)
})

test('empty input stays empty', () => {
  assert.equal(formatHtml(''), '')
  assert.equal(formatHtml('   '), '')
})

test('formatting is stable when applied twice', () => {
  const once = formatHtml('<h1>A</h1><figure><img src="./assets/a.png"><figcaption>x</figcaption></figure>')
  assert.equal(formatHtml(once), once)
})
