// A profile is a stylesheet, not a writer.
//
// Historically every profile field was copied into each node's attributes and rendered as an inline
// `style=`, so a stored document repeated the same handful of declarations dozens of times and a
// profile change had to walk the whole document to take effect. Here a profile becomes one CSS rule
// and a block carries only its class, so changing a profile means changing a rule.
//
// Numbering is expressed with CSS counters rather than stored numbers. The author never types a
// number, and the number is still derived: editing "BAB" to "BEB" in the generated stylesheet
// renumbers every chapter without the editor being involved.

const CSS_NUMBER_STYLES = {
  numeric: 'decimal',
  'roman-upper': 'upper-roman',
  'roman-lower': 'lower-roman',
  'alpha-upper': 'upper-alpha',
  'alpha-lower': 'lower-alpha',
}

const HEADING_PLACEHOLDER = /\{h([1-6])\}/g

const slug = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const profileClassName = (profileId) => {
  const name = slug(profileId)
  return name ? `umo-${name}` : ''
}

export const counterName = (profileId) => {
  const name = slug(profileId)
  return name ? `umo-count-${name}` : ''
}

export const cssNumberStyle = (style) => CSS_NUMBER_STYLES[style] || 'decimal'

// CSS strings are single quoted here, so a quote or backslash inside a template must be escaped.
export const cssString = (value) =>
  `"${String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')}"`

const headingProfilesByLevel = (profiles) => {
  const byLevel = new Map()
  for (const profile of profiles) {
    if (profile?.targetType === 'heading' && profile.level) {
      byLevel.set(Number(profile.level), profile)
    }
  }
  return byLevel
}

// A heading's own number is hierarchical: level 3 reads "1.2.1". Level 1 is the only one that shows
// its configured style, matching getNextHeadingNumber.
const headingNumberContent = (profile, byLevel) => {
  const level = Number(profile.level) || 1
  if (level === 1) {
    return `counter(${counterName(profile.id)}, ${cssNumberStyle(profile.style)})`
  }
  const parts = []
  for (let current = 1; current <= level; current += 1) {
    const ancestor = byLevel.get(current)
    if (!ancestor) continue
    if (parts.length > 0) parts.push('"."')
    parts.push(`counter(${counterName(ancestor.id)})`)
  }
  return parts.join(' ')
}

// {h1}..{h6} are always plain digits: a chapter shown as "BAB I" is still chapter 1 to a figure.
const expandTemplate = (profile, byLevel, ownNumber) => {
  const template = profile.template ?? ''
  if (!template) {
    return [ownNumber]
  }
  const parts = []
  let literal = ''
  const flush = () => {
    if (literal) {
      parts.push(cssString(literal))
      literal = ''
    }
  }
  const pattern = /\{h([1-6])\}|\{number\}|\{label\}|\{title\}/g
  let cursor = 0
  let match
  while ((match = pattern.exec(template)) !== null) {
    literal += template.slice(cursor, match.index)
    cursor = match.index + match[0].length
    if (match[0] === '{number}') {
      flush()
      parts.push(ownNumber)
    } else if (match[0] === '{label}') {
      literal += profile.name || ''
    } else if (match[0] === '{title}') {
      // A title is document content, not something a stylesheet can reach.
      literal += ''
    } else {
      const ancestor = byLevel.get(Number(match[1]))
      if (ancestor) {
        flush()
        parts.push(`counter(${counterName(ancestor.id)})`)
      }
    }
  }
  literal += template.slice(cursor)
  flush()
  return parts.length > 0 ? parts : [cssString('')]
}

const STYLE_FIELDS = [
  ['marginTop', 'margin-top'],
  ['marginBottom', 'margin-bottom'],
  ['fontFamily', 'font-family'],
  ['fontSize', 'font-size'],
  ['fontWeight', 'font-weight'],
  ['lineHeight', 'line-height'],
  ['textAlign', 'text-align'],
]

const INDENT_STEP = 2

const declarationsFor = (profile) => {
  const out = []
  for (const [field, property] of STYLE_FIELDS) {
    const value = profile[field]
    if (value === undefined || value === null || value === '') continue
    out.push(`${property}: ${field === 'fontFamily' ? `"${value}"` : value};`)
  }
  const indent = Number(profile.indent)
  if (Number.isFinite(indent) && indent > 0) {
    out.push(`text-indent: ${indent * INDENT_STEP}em;`)
  }
  return out
}

export const DOCUMENT_SCOPE = '.umo-document'

/**
 * Build the stylesheet for a set of profiles.
 *
 * `scope` is the selector for the element that contains the blocks. It carries the root counters and
 * prefixes every rule, so the same generator serves both the stored file (`.umo-document`) and the
 * live editor (its ProseMirror element) without two sets of rules drifting apart.
 */
export const buildProfileStylesheet = (
  profiles = [],
  { scope = DOCUMENT_SCOPE, numbering = true } = {},
) => {
  const list = Array.isArray(profiles) ? profiles.filter(Boolean) : []
  if (list.length === 0) return ''
  const prefix = String(scope || '').trim()
  const sel = (rest) => (prefix ? `${prefix} ${rest}` : rest)

  const byLevel = headingProfilesByLevel(list)
  // The editor draws numbers with a ProseMirror decoration, which is a real DOM node the pagination
  // engine can measure; generated content produces no text node and would be invisible to it. So the
  // editor asks for styling only, and the counters go to the stored file where nothing else draws
  // them. Both come from this one function, so the two cannot drift apart.
  const numbered = numbering
    ? list.filter((p) => p.enabled && p.template !== undefined)
    : []

  // Which counters each heading level restarts: deeper headings, plus any profile whose template
  // names that level. The template declares its own reset scope.
  const resetsFor = (profile) => {
    const resets = []
    if (profile.targetType === 'heading' && profile.level) {
      const level = Number(profile.level)
      for (const [otherLevel, other] of byLevel) {
        if (otherLevel > level && numbered.includes(other)) resets.push(counterName(other.id))
      }
      for (const other of numbered) {
        if (other.targetType === 'heading') continue
        let scope = 0
        for (const m of String(other.template || '').matchAll(HEADING_PLACEHOLDER)) {
          scope = Math.max(scope, Number(m[1]))
        }
        if (scope === level) resets.push(counterName(other.id))
      }
    }
    return resets
  }

  // A counter that a heading restarts must NOT also be reset at the root. Measured in Chrome: with
  // both, the root's counter wins for the sibling lookup and the chapter reset is ignored, so the
  // second chapter's first figure reads "2.3" instead of "2.1". Only counters that nothing else
  // restarts are seeded here; the rest are created by the heading that owns them.
  const restartedByHeading = new Set()
  for (const profile of list) {
    for (const name of resetsFor(profile)) restartedByHeading.add(name)
  }

  const blocks = []
  const rootResets = numbered
    .map((p) => counterName(p.id))
    .filter((name) => !restartedByHeading.has(name))
  if (rootResets.length > 0) {
    blocks.push(`${prefix || ':root'} {\n  counter-reset: ${rootResets.join(' ')};\n}`)
  }

  for (const profile of list) {
    const cls = profileClassName(profile.id)
    if (!cls) continue
    const decls = declarationsFor(profile)
    const isNumbered = numbered.includes(profile)
    if (isNumbered) {
      decls.push(`counter-increment: ${counterName(profile.id)};`)
      const resets = resetsFor(profile)
      if (resets.length > 0) decls.push(`counter-reset: ${resets.join(' ')};`)
    }
    if (decls.length > 0) {
      blocks.push(`${sel(`.${cls}`)} {\n${decls.map((d) => `  ${d}`).join('\n')}\n}`)
    }
    if (!isNumbered) continue

    const ownNumber =
      profile.targetType === 'heading'
        ? headingNumberContent(profile, byLevel)
        : `counter(${counterName(profile.id)}, ${cssNumberStyle(profile.style)})`
    const content = expandTemplate(profile, byLevel, ownNumber)
    // Mirrors .umo-heading-number in editor.less, so the stored file and the editor put the number
    // in the same place. A template with a newline becomes a block, exactly as the widget does.
    const multiline = String(profile.template || '').includes('\n')
    const before = [
      `content: ${content.join(' ')};`,
      'font-variant-numeric: tabular-nums;',
      'white-space: pre-wrap;',
    ]
    if (multiline) {
      before.push('display: block;', 'width: 100%;', 'margin-right: 0;', 'margin-bottom: 0;')
    } else {
      before.push('display: inline;', 'margin-right: 0.4em;')
    }
    blocks.push(`${sel(`.${cls}`)}::before {\n${before.map((d) => `  ${d}`).join('\n')}\n}`)
  }

  return blocks.join('\n\n')
}
