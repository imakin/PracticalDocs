import assert from 'node:assert/strict'
import test from 'node:test'

import { renderMarkdown } from '../../src/utils/markdown.js'

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
