/**
 * Lays a document's HTML out so a person can read and edit it.
 *
 * Whitespace inside a text block is content: the editor parses with `preserveWhitespace: 'full'`, so
 * indenting the inside of a paragraph would change the paragraph. Only the gaps *between* block
 * elements are touched, and `<pre>` is copied out byte for byte because every character in a code
 * block is meaningful.
 */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'caption', 'colgroup', 'div', 'dd', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul',
])
// Nothing goes inside these, so they never open a level of indentation.
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
])
const VERBATIM_TAGS = new Set(['pre', 'code', 'script', 'style', 'textarea'])

const INDENT = '  '

export const formatHtml = (html) => {
  const source = String(html || '')
  if (!source.trim()) {
    return ''
  }

  const out = []
  let depth = 0
  let atLineStart = true

  const newline = () => {
    if (!atLineStart) {
      out.push('\n')
      atLineStart = true
    }
  }
  const write = (text) => {
    if (!text) {
      return
    }
    if (atLineStart) {
      out.push(INDENT.repeat(Math.max(0, depth)))
      atLineStart = false
    }
    out.push(text)
  }

  let index = 0
  while (index < source.length) {
    const open = source.indexOf('<', index)
    if (open === -1) {
      write(source.slice(index))
      break
    }
    if (open > index) {
      // Text between tags. Collapsing it would edit the document, so the inside is written untouched.
      // Only whitespace containing a newline is trimmed from the edges: the editor never emits a raw
      // newline inside text - a line break is a <br> - so such whitespace can only be layout this
      // formatter added itself, and leaving it would make a second pass keep growing the file.
      const text = source.slice(index, open)
      if (text.trim()) {
        write(text.replace(/^\s*\n\s*/, '').replace(/\s*\n\s*$/, ''))
      }
    }

    const close = source.indexOf('>', open)
    if (close === -1) {
      write(source.slice(open))
      break
    }
    const tag = source.slice(open, close + 1)
    const match = tag.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/)
    const name = match ? match[1].toLowerCase() : ''
    const isClosing = tag.startsWith('</')
    const isSelfClosing = tag.endsWith('/>') || VOID_TAGS.has(name)

    // Everything inside a verbatim element is content down to the last space.
    if (!isClosing && VERBATIM_TAGS.has(name) && !isSelfClosing) {
      const endTag = `</${name}>`
      const end = source.toLowerCase().indexOf(endTag, close + 1)
      const stop = end === -1 ? source.length : end + endTag.length
      newline()
      write(source.slice(open, stop))
      newline()
      index = stop
      continue
    }

    if (BLOCK_TAGS.has(name)) {
      if (isClosing) {
        depth -= 1
        newline()
        write(tag)
        newline()
      } else {
        newline()
        write(tag)
        if (!isSelfClosing) {
          depth += 1
        }
        newline()
      }
    } else {
      write(tag)
    }
    index = close + 1
  }

  return `${out.join('').replace(/\n{3,}/g, '\n\n').trim()}\n`
}
