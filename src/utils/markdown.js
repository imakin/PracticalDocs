import MarkdownIt from 'markdown-it'

/**
 * Markdown, rendered into the markup this editor already understands.
 *
 * Math is the part worth explaining. The rules below do not render a formula; they emit the markup
 * `@tiptap/extension-mathematics` parses - `span[data-type="inline-math"]` and
 * `div[data-type="block-math"]`, each carrying `data-latex`. The formula therefore becomes a real
 * Tiptap math node, drawn by the same KaTeX the rest of the document uses.
 *
 * Rendering it here instead would put a second math renderer in one document, where the same formula
 * could look different depending on which kind of block it sits in. ADR 0012 records that decision,
 * and why MathJax was offered and declined.
 */

const DOLLAR = 0x24
const BACKSLASH = 0x5c

const escapeAttribute = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

// A delimiter preceded by an odd number of backslashes was escaped by the writer and is a literal
// dollar sign. An even number means the backslashes escaped each other.
const isEscaped = (source, position) => {
  let count = 0
  let index = position - 1
  while (index >= 0 && source.charCodeAt(index) === BACKSLASH) {
    count += 1
    index -= 1
  }
  return count % 2 === 1
}

const inlineMathRule = (state, silent) => {
  const start = state.pos
  if (state.src.charCodeAt(start) !== DOLLAR || isEscaped(state.src, start)) {
    return false
  }
  // Two dollars open display math, which the block rule owns.
  if (state.src.charCodeAt(start + 1) === DOLLAR) {
    return false
  }
  let end = start + 1
  while (end < state.posMax) {
    if (state.src.charCodeAt(end) === DOLLAR && !isEscaped(state.src, end)) {
      break
    }
    end += 1
  }
  if (end >= state.posMax) {
    return false
  }
  const latex = state.src.slice(start + 1, end)
  // "$ 20 and $ 30" is a price, not a formula. A delimiter counts only when it hugs its content,
  // which is the same rule every markdown math implementation settles on.
  if (!latex.trim() || /^\s|\s$/.test(latex)) {
    return false
  }
  if (!silent) {
    const token = state.push('math_inline', '', 0)
    token.content = latex
    token.markup = '$'
  }
  state.pos = end + 1
  return true
}

const blockMathRule = (state, startLine, endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]
  if (
    start + 1 >= max ||
    state.src.charCodeAt(start) !== DOLLAR ||
    state.src.charCodeAt(start + 1) !== DOLLAR
  ) {
    return false
  }

  const opening = state.src.slice(start + 2, max).trim()
  let line = startLine
  let latex = ''
  let closed = false

  if (opening.endsWith('$$')) {
    // The whole formula sits on one line: `$$ x = 1 $$`.
    latex = opening.slice(0, -2)
    closed = true
  } else {
    const collected = opening ? [opening] : []
    while (line + 1 < endLine) {
      line += 1
      const text = state.src.slice(
        state.bMarks[line] + state.tShift[line],
        state.eMarks[line],
      )
      const trimmed = text.trim()
      if (trimmed.endsWith('$$')) {
        const body = trimmed.slice(0, -2)
        if (body) {
          collected.push(body)
        }
        closed = true
        break
      }
      collected.push(text)
    }
    latex = collected.join('\n')
  }

  // An unterminated `$$` is not display math. Leaving it to the paragraph rule means the writer sees
  // their dollars where they typed them, rather than the rest of the document silently vanishing
  // into a formula.
  if (!closed) {
    return false
  }
  if (silent) {
    return true
  }
  state.line = line + 1
  const token = state.push('math_block', '', 0)
  token.block = true
  token.content = latex.trim()
  token.markup = '$$'
  token.map = [startLine, state.line]
  return true
}

/**
 * A cross-reference, written as `[[ref:<id>]]`.
 *
 * The rule emits the same anchor the cross-reference node parses, so a reference typed in markdown
 * becomes a real `crossReference` node and is renumbered by the same sync that renumbers every other
 * reference in the document. Rendering the number here instead would freeze it at the moment the
 * block was last edited, which is the one thing a cross-reference must never do.
 *
 * The display mode follows a pipe: `[[ref:abc123|title]]`. An unknown mode falls back to the label,
 * because a typo in a mode name should still produce a working reference.
 */
const REFERENCE_OPEN = '[[ref:'
const REFERENCE_CLOSE = ']]'
const DISPLAY_MODES = new Set(['label', 'title', 'label-title'])
const BRACKET = 0x5b

export const crossReferenceToken = (targetId, displayMode = 'label') =>
  DISPLAY_MODES.has(displayMode) && displayMode !== 'label'
    ? `${REFERENCE_OPEN}${targetId}|${displayMode}${REFERENCE_CLOSE}`
    : `${REFERENCE_OPEN}${targetId}${REFERENCE_CLOSE}`

const crossReferenceRule = (state, silent) => {
  const start = state.pos
  if (state.src.charCodeAt(start) !== BRACKET) {
    return false
  }
  if (
    state.src.slice(start, start + REFERENCE_OPEN.length) !== REFERENCE_OPEN
  ) {
    return false
  }
  const end = state.src.indexOf(REFERENCE_CLOSE, start + REFERENCE_OPEN.length)
  if (end === -1 || end >= state.posMax) {
    return false
  }
  const body = state.src.slice(start + REFERENCE_OPEN.length, end)
  // An id is one token: no whitespace, no nested brackets. Anything else is a writer typing square
  // brackets, and it stays the text they typed.
  if (!body || /[\s[\]]/.test(body)) {
    return false
  }
  const [targetId, mode] = body.split('|')
  if (!targetId) {
    return false
  }
  if (!silent) {
    const token = state.push('cross_reference', '', 0)
    token.content = targetId
    token.meta = { displayMode: DISPLAY_MODES.has(mode) ? mode : 'label' }
  }
  state.pos = end + REFERENCE_CLOSE.length
  return true
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
})

markdown.inline.ruler.before('escape', 'math_inline', inlineMathRule)
// Before the link rule, or `[[ref:id]]` is offered to it first and comes back as bracketed text.
markdown.inline.ruler.before('link', 'cross_reference', crossReferenceRule)
markdown.block.ruler.before('fence', 'math_block', blockMathRule, {
  alt: ['paragraph', 'reference', 'blockquote', 'list'],
})

markdown.renderer.rules.math_inline = (tokens, index) =>
  `<span data-type="inline-math" data-latex="${escapeAttribute(tokens[index].content)}"></span>`

/**
 * Empty on purpose. The text of a reference is `referenceText`, written by the reference sync from
 * the target's current number - so the markup carries the target and nothing that can go stale.
 */
markdown.renderer.rules.cross_reference = (tokens, index) => {
  const id = escapeAttribute(tokens[index].content)
  const mode = escapeAttribute(tokens[index].meta?.displayMode || 'label')
  return (
    `<a data-type="cross-reference" data-target-id="${id}" data-display-mode="${mode}"` +
    ` data-target-number="" data-target-text="" data-missing="false" href="#reference-${id}"></a>`
  )
}

markdown.renderer.rules.math_block = (tokens, index) =>
  `<div data-type="block-math" data-latex="${escapeAttribute(tokens[index].content)}"></div>`

export const renderMarkdown = (content) =>
  markdown.render(String(content || ''))
