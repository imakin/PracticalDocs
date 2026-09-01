/**
 * How markdown looks. Its own group, separate from the block style profiles.
 *
 * A block style profile answers "which profile is this one block under", and is chosen per block.
 * Markdown is not like that: `# Judul` is an h1 because the writer typed a hash, not because anyone
 * assigned it anything. So markdown styling is one setting for the whole document, with a section
 * for each kind of thing markdown can produce.
 *
 * `adr/0012-a-markdown-block-keeps-its-source.md`, amendment 3.
 *
 * ## Adding a setting later
 *
 * Everything here is a table, and the generator, the defaults and the settings dialog are all built
 * from those tables. There is no third place that has to be kept in step.
 *
 * - **A new style field** (letter spacing, say): add one row to `MARKDOWN_STYLE_FIELDS`. It appears
 *   in the dialog for every section and is emitted as CSS wherever it is set.
 * - **A new section** (blockquote, code block, table): add one row to `MARKDOWN_STYLE_TARGETS` with
 *   the selector it matches inside a markdown block.
 *
 * A field that is not a plain property - one that has to produce several rules, the way nesting
 * indent does - is written as a `rules` function on the target instead. That is the escape hatch, and
 * it exists so the common case can stay a table.
 */

const SIZES = ['9pt', '10pt', '10.5pt', '11pt', '12pt', '14pt', '16pt', '18pt', '24pt', '30pt']
const LENGTHS = ['0', '0.25em', '0.5em', '1em', '1.5em', '2em', '3em', '4em', '8px', '12px', '16px']
const FAMILIES = [
  'Times New Roman',
  'Arial',
  'Helvetica',
  'Georgia',
  'Courier New',
  'Cambria',
  'Calibri',
]

/**
 * One row per style setting.
 *
 * `css` is the property it writes. `block` marks a setting that only means something for a block -
 * a margin on an inline formula would be ignored by the browser and confusing in the dialog, so
 * those fields are not offered for inline sections.
 *
 * `suggestions` are offered, never imposed. Every field accepts a typed value as well, the same way
 * the block profile fields do - a list of choices is a convenience, not a decision the dialog gets
 * to make on the writer's behalf.
 */
export const MARKDOWN_STYLE_FIELDS = [
  { key: 'fontFamily', label: 'Font Family', css: 'font-family', placeholder: 'e.g. Times New Roman', suggestions: FAMILIES },
  { key: 'fontSize', label: 'Font Size', css: 'font-size', placeholder: 'e.g. 12pt', suggestions: SIZES },
  { key: 'fontWeight', label: 'Font Weight', css: 'font-weight', placeholder: 'e.g. bold, 400', suggestions: ['normal', 'bold', '300', '400', '500', '600', '700'] },
  { key: 'lineHeight', label: 'Line Height', css: 'line-height', placeholder: 'e.g. 1.5', block: true, suggestions: ['1', '1.15', '1.25', '1.5', '1.75', '2', '2.5', '3'] },
  { key: 'marginTop', label: 'Top Margin', css: 'margin-top', placeholder: 'e.g. 0.5em', block: true, suggestions: LENGTHS },
  { key: 'marginBottom', label: 'Bottom Margin', css: 'margin-bottom', placeholder: 'e.g. 0.5em', block: true, suggestions: LENGTHS },
  { key: 'textAlign', label: 'Alignment', css: 'text-align', placeholder: 'left, center, right, justify', block: true, suggestions: ['left', 'center', 'right', 'justify'] },
  { key: 'textIndent', label: 'First Line Indent', css: 'text-indent', placeholder: 'e.g. 2em', block: true, suggestions: LENGTHS },
]

/**
 * Indentation added by each level of nesting, for lists.
 *
 * Not a plain declaration, because it has to say two things: a top level list is not indented at all,
 * and every level below it adds this much. Level 0 at zero was asked for explicitly - a markdown list
 * should start at the text margin like the paragraphs around it, not at the browser's own inset.
 */
export const NESTED_INDENT_FIELD = {
  key: 'nestedIndent',
  label: 'Nested Indent',
  placeholder: 'e.g. 2em, added per level',
  suggestions: LENGTHS,
}

/**
 * One row per kind of thing markdown produces.
 *
 * `selector` is matched inside a markdown block's rendered content, so it can be as plain as the tag.
 * `inline` drops the block-only fields. `nested` adds the nesting indent setting.
 */
export const MARKDOWN_STYLE_TARGETS = [
  { key: 'paragraph', name: 'Normal Paragraph', selector: 'p' },
  { key: 'h1', name: 'Heading 1', selector: 'h1' },
  { key: 'h2', name: 'Heading 2', selector: 'h2' },
  { key: 'h3', name: 'Heading 3', selector: 'h3' },
  { key: 'h4', name: 'Heading 4', selector: 'h4' },
  { key: 'h5', name: 'Heading 5', selector: 'h5' },
  { key: 'h6', name: 'Heading 6', selector: 'h6' },
  { key: 'bulletList', name: 'Bullet List', selector: 'ul', nested: true },
  { key: 'orderedList', name: 'Numbered List', selector: 'ol', nested: true },
  { key: 'listItem', name: 'List Item', selector: 'li' },
  { key: 'inlineMath', name: 'Inline Math', selector: '[data-type="inline-math"]', inline: true },
  { key: 'blockMath', name: 'Block Math', selector: '[data-type="block-math"]' },
]

// The container every rule is scoped inside. A markdown block's rendered half, and nothing else.
export const MARKDOWN_SCOPE = '.umo-markdown-rendered'

export const fieldsFor = (target) =>
  MARKDOWN_STYLE_FIELDS.filter((field) => !field.block || !target?.inline)

export const defaultMarkdownStyles = () => {
  const styles = {}
  for (const target of MARKDOWN_STYLE_TARGETS) {
    styles[target.key] = {}
  }
  return styles
}

/**
 * A stored object with every section present, and nothing invented.
 *
 * Empty everywhere by default, which is the point: until the writer sets something, markdown renders
 * as markdown. A section this version does not know about is carried through untouched, so a
 * document written by a later version does not lose its settings by being opened here.
 */
export const withMarkdownStyleDefaults = (saved) => {
  const styles = { ...(saved && typeof saved === 'object' ? saved : {}) }
  for (const target of MARKDOWN_STYLE_TARGETS) {
    styles[target.key] = { ...(styles[target.key] || {}) }
  }
  return styles
}

const isSet = (value) =>
  value !== undefined && value !== null && String(value).trim() !== ''

/**
 * The CSS for one markdown styling object.
 *
 * `scope` is the selector for the element containing the editor's content, so two editors on one
 * page cannot restyle each other. The same function writes the rules into a saved document, so the
 * screen and the file come from one source and cannot drift - the rule ADR 0007 exists for.
 */
export const markdownStyleRules = (styles, scope = '') => {
  const settings = withMarkdownStyleDefaults(styles)
  const prefix = scope ? `${scope} ${MARKDOWN_SCOPE}` : MARKDOWN_SCOPE
  const blocks = []

  for (const target of MARKDOWN_STYLE_TARGETS) {
    const values = settings[target.key] || {}
    const declarations = []
    for (const field of fieldsFor(target)) {
      if (isSet(values[field.key])) {
        declarations.push(`${field.css}: ${String(values[field.key]).trim()};`)
      }
    }
    if (declarations.length > 0) {
      blocks.push(
        `${prefix} ${target.selector} {\n${declarations.map((d) => `  ${d}`).join('\n')}\n}`,
      )
    }

    if (!target.nested || !isSet(values[NESTED_INDENT_FIELD.key])) {
      continue
    }
    const step = String(values[NESTED_INDENT_FIELD.key]).trim()
    // Level 0 sits at the text margin; every level below adds one step. Written as two rules rather
    // than one per level, because a nested list is already inside its parent's box, so the steps
    // accumulate on their own however deep the writer goes.
    blocks.push(`${prefix} > ${target.selector} {\n  padding-left: 0;\n}`)
    blocks.push(
      `${prefix} ${target.selector} ${target.selector} {\n  padding-left: ${step};\n}`,
    )
  }

  return blocks.join('\n\n')
}
