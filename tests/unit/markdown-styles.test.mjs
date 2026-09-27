import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultMarkdownStyles,
  fieldsFor,
  markdownStyleRules,
  MARKDOWN_STYLE_FIELDS,
  MARKDOWN_STYLE_TARGETS,
  withMarkdownStyleDefaults,
} from '../../src/utils/markdown-styles.js'

test('nothing set means no rules at all', () => {
  // Until the writer sets something, markdown renders as markdown.
  assert.equal(markdownStyleRules(defaultMarkdownStyles(), '.scope'), '')
  assert.equal(markdownStyleRules(null, '.scope'), '')
})

test('a setting becomes a rule scoped inside a markdown block', () => {
  const css = markdownStyleRules({ h1: { fontSize: '24pt' } }, '.scope')
  assert.match(css, /\.scope \.pdoc-markdown-rendered h1 \{/)
  assert.match(css, /font-size: 24pt;/)
  // Scoped, or two editors on one page restyle each other.
  assert.doesNotMatch(css, /^h1 \{/m)
})

test('each section is independent', () => {
  const css = markdownStyleRules(
    { h1: { fontSize: '24pt' }, paragraph: { fontSize: '12pt' } },
    '.scope',
  )
  assert.match(css, /h1 \{\n {2}font-size: 24pt;\n\}/)
  assert.match(css, /p \{\n {2}font-size: 12pt;\n\}/)
})

test('inline sections are not offered block-only settings, and never emit them', () => {
  const inlineMath = MARKDOWN_STYLE_TARGETS.find((t) => t.key === 'inlineMath')
  const keys = fieldsFor(inlineMath).map((f) => f.key)
  assert.ok(keys.includes('fontSize'))
  // A margin on an inline formula is ignored by the browser; offering it would be a control that
  // does nothing.
  assert.ok(!keys.includes('marginTop'))
  assert.ok(!keys.includes('textIndent'))

  const css = markdownStyleRules(
    { inlineMath: { fontSize: '11pt', marginTop: '5em' } },
    '.scope',
  )
  assert.match(css, /font-size: 11pt;/)
  assert.doesNotMatch(css, /margin-top/)
})

test('a block section keeps every setting', () => {
  const paragraph = MARKDOWN_STYLE_TARGETS.find((t) => t.key === 'paragraph')
  assert.equal(fieldsFor(paragraph).length, MARKDOWN_STYLE_FIELDS.length)
})

test('nesting indent puts level zero at the margin and adds one step per level', () => {
  const css = markdownStyleRules({ bulletList: { nestedIndent: '2em' } }, '.scope')
  // Level 0 at zero was asked for explicitly: a markdown list starts at the text margin.
  assert.match(css, /\.pdoc-markdown-rendered > ul \{\n {2}padding-left: 0;\n\}/)
  // One step per level, accumulating because a nested list sits inside its parent's box.
  assert.match(css, /\.pdoc-markdown-rendered ul ul \{\n {2}padding-left: 2em;\n\}/)
})

test('nesting indent is only offered where nesting means something', () => {
  const nested = MARKDOWN_STYLE_TARGETS.filter((t) => t.nested).map((t) => t.key)
  assert.deepEqual(nested, ['bulletList', 'orderedList'])
  const css = markdownStyleRules({ paragraph: { nestedIndent: '2em' } }, '.scope')
  assert.equal(css, '')
})

test('an empty string is not a setting', () => {
  // The difference between "not set" and "set to nothing" decides whether a rule exists at all.
  assert.equal(markdownStyleRules({ h1: { fontSize: '   ' } }, '.scope'), '')
  assert.equal(markdownStyleRules({ h1: { fontSize: null } }, '.scope'), '')
})

test('every section is present after defaults are applied', () => {
  const filled = withMarkdownStyleDefaults({ h1: { fontSize: '20pt' } })
  for (const target of MARKDOWN_STYLE_TARGETS) {
    assert.ok(filled[target.key], `${target.key} is missing`)
  }
  assert.equal(filled.h1.fontSize, '20pt')
})

test('a section this version does not know about is carried through', () => {
  // A document written by a later version must not lose its settings by being opened here.
  const filled = withMarkdownStyleDefaults({ blockquote: { fontSize: '9pt' } })
  assert.equal(filled.blockquote.fontSize, '9pt')
})

test('the tables are the only place a setting is declared', () => {
  // The dialog and the generator are both built from these, so a duplicate key would silently make
  // one of them wrong.
  const fieldKeys = MARKDOWN_STYLE_FIELDS.map((f) => f.key)
  assert.equal(new Set(fieldKeys).size, fieldKeys.length)
  const targetKeys = MARKDOWN_STYLE_TARGETS.map((t) => t.key)
  assert.equal(new Set(targetKeys).size, targetKeys.length)
  for (const field of MARKDOWN_STYLE_FIELDS) {
    assert.ok(field.css, `${field.key} declares no css property`)
  }
  for (const target of MARKDOWN_STYLE_TARGETS) {
    assert.ok(target.selector, `${target.key} declares no selector`)
    assert.ok(target.name, `${target.key} has no name for the dialog`)
  }
})

test("a paragraph's first line indent stops at the edge of a list", () => {
  // Markdown renders a spaced list as `li > p`, so the Normal Paragraph rule lands on the text of
  // every list item too. That is wanted for the font and wrong for the indent: a thesis body indents
  // its first line, a bullet must not.
  const css = markdownStyleRules({ paragraph: { textIndent: '2em' } }, '.scope')
  assert.match(css, /\.scope \.pdoc-markdown-rendered p \{[^}]*text-indent: 2em;/)
  assert.match(
    css,
    /\.scope \.pdoc-markdown-rendered ul li p \{\n  text-indent: 0;/,
  )
  assert.match(
    css,
    /\.scope \.pdoc-markdown-rendered ol li p \{\n  text-indent: 0;/,
  )
})

test('a list says what its own first line indent is', () => {
  const css = markdownStyleRules(
    { paragraph: { textIndent: '2em' }, bulletList: { textIndent: '1em' } },
    '.scope',
  )
  assert.match(
    css,
    /\.scope \.pdoc-markdown-rendered ul li p \{\n  text-indent: 1em;/,
  )
  // The numbered list said nothing, so it takes none rather than the paragraph's.
  assert.match(
    css,
    /\.scope \.pdoc-markdown-rendered ol li p \{\n  text-indent: 0;/,
  )
})

test('List Item wins over the kind of list it is in', () => {
  const css = markdownStyleRules(
    { listItem: { textIndent: '3em' }, bulletList: { textIndent: '1em' } },
    '.scope',
  )
  assert.match(
    css,
    /\.scope \.pdoc-markdown-rendered ul li p \{\n  text-indent: 3em;/,
  )
})

test('a document that sets no indent anywhere gets no indent rule', () => {
  const css = markdownStyleRules({ h1: { fontSize: '24pt' } }, '.scope')
  assert.doesNotMatch(css, /text-indent/)
})

test('a code block is styled on its pre, inline code only outside one', () => {
  const css = markdownStyleRules(
    {
      codeBlock: { fontFamily: 'Courier New', marginTop: '1em' },
      inlineCode: { fontSize: '10pt', marginTop: '5em' },
    },
    '.scope',
  )
  assert.match(
    css,
    /\.scope \.pdoc-markdown-rendered pre \{\n {2}font-family: Courier New;\n {2}margin-top: 1em;\n\}/,
  )
  // The code inside a code block is the block's own text and must not be caught by Inline Code.
  assert.match(
    css,
    /\.scope \.pdoc-markdown-rendered :not\(pre\) > code \{\n {2}font-size: 10pt;\n\}/,
  )
  // Inline, so no margins are offered or emitted for it.
  assert.doesNotMatch(css, /margin-top: 5em/)
})
