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
  assert.match(css, /\.scope \.umo-markdown-rendered h1 \{/)
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
  assert.match(css, /\.umo-markdown-rendered > ul \{\n {2}padding-left: 0;\n\}/)
  // One step per level, accumulating because a nested list sits inside its parent's box.
  assert.match(css, /\.umo-markdown-rendered ul ul \{\n {2}padding-left: 2em;\n\}/)
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
