import assert from 'node:assert/strict'
import test from 'node:test'

import { crossReferenceToken, renderMarkdown } from '../../src/utils/markdown.js'

test('ordinary markdown still renders as it did', () => {
  assert.match(renderMarkdown('# Metodologi'), /<h1>Metodologi<\/h1>/)
  assert.match(renderMarkdown('- one\n- two'), /<ul>/)
  assert.match(renderMarkdown('**bold**'), /<strong>bold<\/strong>/)
})

test('inline math becomes the markup the math extension parses', () => {
  const html = renderMarkdown('The equation is $E = mc^2$ exactly.')
  assert.match(html, /<span data-type="inline-math" data-latex="E = mc\^2"><\/span>/)
  // The prose around it survives, so the formula replaced only itself.
  assert.match(html, /The equation is /)
  assert.match(html, / exactly\./)
})

test('display math becomes a block math node', () => {
  const html = renderMarkdown('$$\nx = \\frac{1}{2}\n$$')
  assert.match(html, /<div data-type="block-math" data-latex="x = \\frac\{1\}\{2\}"><\/div>/)
})

test('display math written on one line closes on that line', () => {
  const html = renderMarkdown('$$ x = 1 $$')
  assert.match(html, /<div data-type="block-math" data-latex="x = 1"><\/div>/)
})

test('a price is not a formula', () => {
  // The delimiter has to hug its content. Without this rule a document mentioning two amounts turns
  // the text between them into mathematics.
  const html = renderMarkdown('It costs $ 20 and then $ 30 more.')
  assert.doesNotMatch(html, /inline-math/)
  assert.match(html, /It costs \$ 20 and then \$ 30 more\./)
})

test('an escaped dollar stays a dollar', () => {
  const html = renderMarkdown('A literal \\$x\\$ sign.')
  assert.doesNotMatch(html, /inline-math/)
})

test('an unterminated display block is left as the writer typed it', () => {
  // Consuming to the end of the document would make one stray line swallow everything after it.
  const html = renderMarkdown('$$\nx = 1\n\nAn ordinary paragraph.')
  assert.doesNotMatch(html, /block-math/)
  assert.match(html, /An ordinary paragraph\./)
})

test('latex is escaped for the attribute it is stored in', () => {
  // A formula containing a quote or an angle bracket must not be able to end the attribute or open
  // a tag. `a < b` and `\text{"x"}` are both ordinary mathematics.
  const html = renderMarkdown('$a < b$')
  assert.match(html, /data-latex="a &lt; b"/)
  assert.doesNotMatch(html, /data-latex="a < b"/)

  const quoted = renderMarkdown('$\\text{"x"}$')
  assert.match(quoted, /data-latex="\\text\{&quot;x&quot;\}"/)
})

test('an empty source renders nothing', () => {
  assert.equal(renderMarkdown('').trim(), '')
  assert.equal(renderMarkdown(null).trim(), '')
  assert.equal(renderMarkdown(undefined).trim(), '')
})

test('a cross-reference becomes the anchor the reference node parses', () => {
  const html = renderMarkdown('Lihat [[ref:abc123]] untuk rinciannya.')
  assert.match(html, /<a data-type="cross-reference" data-target-id="abc123"/)
  assert.match(html, /data-display-mode="label"/)
  // Empty on purpose: the text is the target's current number, written by the reference sync. Any
  // text baked in here would be the number as it stood when the block was last edited.
  assert.match(html, /href="#reference-abc123"><\/a>/)
  assert.match(html, /Lihat /)
  assert.match(html, / untuk rinciannya\./)
})

test('a display mode travels with the reference', () => {
  assert.match(renderMarkdown('[[ref:t1|title]]'), /data-display-mode="title"/)
  assert.match(renderMarkdown('[[ref:t1|label-title]]'), /data-display-mode="label-title"/)
  // A mode nobody defined is a typo, and a typo should still give a working reference.
  assert.match(renderMarkdown('[[ref:t1|shouty]]'), /data-display-mode="label"/)
})

test('the token the toolbar writes is the token the parser reads', () => {
  assert.equal(crossReferenceToken('abc'), '[[ref:abc]]')
  assert.equal(crossReferenceToken('abc', 'label'), '[[ref:abc]]')
  assert.equal(crossReferenceToken('abc', 'title'), '[[ref:abc|title]]')
  assert.match(renderMarkdown(crossReferenceToken('abc', 'title')), /data-target-id="abc"/)
})

test('ordinary square brackets are left alone', () => {
  // The rule must not claim every pair of brackets the writer types.
  const html = renderMarkdown('Nilai [1] dan [[dua]] dan [[ref: spasi]] tetap teks.')
  assert.doesNotMatch(html, /cross-reference/)
  assert.match(html, /\[\[ref: spasi\]\]/)
})

test('an ordinary markdown link still becomes a link', () => {
  const html = renderMarkdown('[situs](https://example.com)')
  assert.match(html, /<a href="https:\/\/example\.com">situs<\/a>/)
  assert.doesNotMatch(html, /cross-reference/)
})

test('a target id is escaped into its attributes', () => {
  const html = renderMarkdown('[[ref:a"onload=x]]')
  assert.doesNotMatch(html, /data-target-id="a"onload/)
  assert.match(html, /&quot;/)
})
