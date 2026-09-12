export const REFERENCE_TARGET_TYPES = ['heading', 'paragraph', 'figure', 'table', 'citation']

export const REFERENCE_DISPLAY_MODES = ['label', 'title', 'label-title']

export const NUMBERING_STYLES = [
  'numeric',
  'roman-upper',
  'roman-lower',
  'alpha-upper',
  'alpha-lower',
]

export const DEFAULT_REFERENCE_LABELS = {
  heading: 'Section',
  figure: 'Figure',
  table: 'Table',
  missing: 'Reference unavailable',
}

export const DEFAULT_TEMPLATES = {
  heading: '{number}',
  figure: '{label} {number}',
  table: '{label} {number}',
  citation: '[{number}]',
}

/**
 * Types that hold something rather than being numbered.
 *
 * An image is a container and so is a table: what carries the number is **the caption the writer
 * gives a profile to**, exactly as a heading carries its own. Nothing here is numbered on the
 * writer's behalf, which is the whole rule - a document shows no number the writer did not ask for.
 *
 * A table used to number itself by type. The number was invisible, because `adr/0009` removed the
 * caption element that once drew it, but it was still consumed: a caption paragraph given the table
 * profile came out `Table 2` while the table above it silently held `Table 1`.
 */
const CONTAINER_TARGET_TYPES = new Set(['figure', 'table'])

const normalizeText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeLevel = (value) => {
  const level = Number(value)
  if (!Number.isInteger(level)) {
    return 1
  }
  return Math.min(6, Math.max(1, level))
}

export const toRoman = (num, uppercase = true) => {
  const n = Math.max(1, Math.min(3999, Math.floor(Number(num) || 1)))
  const lookup = [
    ['M', 1000],
    ['CM', 900],
    ['D', 500],
    ['CD', 400],
    ['C', 100],
    ['XC', 90],
    ['L', 50],
    ['XL', 40],
    ['X', 10],
    ['IX', 9],
    ['V', 5],
    ['IV', 4],
    ['I', 1],
  ]
  let result = ''
  let current = n
  for (const [letter, value] of lookup) {
    while (current >= value) {
      result += letter
      current -= value
    }
  }
  return uppercase ? result : result.toLowerCase()
}

export const toAlphabet = (num, uppercase = true) => {
  let n = Math.max(1, Math.floor(Number(num) || 1))
  let result = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return uppercase ? result : result.toLowerCase()
}

export const formatSingleNumber = (num, style = 'numeric') => {
  const n = Number(num) || 1
  if (style === 'roman-upper') return toRoman(n, true)
  if (style === 'roman-lower') return toRoman(n, false)
  if (style === 'alpha-upper') return toAlphabet(n, true)
  if (style === 'alpha-lower') return toAlphabet(n, false)
  return String(n)
}

export const getNextHeadingNumber = (
  counters,
  level,
  { style = 'numeric' } = {},
) => {
  const normalizedLevel = normalizeLevel(level)
  const index = normalizedLevel - 1
  counters[index] = (counters[index] || 0) + 1
  for (let current = normalizedLevel; current < counters.length; current += 1) {
    counters[current] = 0
  }
  const activeSegments = counters
    .slice(0, normalizedLevel)
    .filter((value) => value > 0)

  if (activeSegments.length === 0) {
    return '1'
  }

  if (style !== 'numeric' && normalizedLevel === 1) {
    return formatSingleNumber(activeSegments[0], style)
  }

  return activeSegments.join('.')
}

// {h1} .. {h6} expand to the number of the enclosing heading at that level, so any profile can be
// numbered relative to its chapter: "Figure {h1}.{number}" gives "Figure 1.1". Always plain digits,
// independent of the style that heading is displayed with, since a chapter shown as "BAB I" is still
// chapter 1 when a figure refers to it.
export const HEADING_PLACEHOLDER = /\{h([1-6])\}/g

export const templateScopeLevel = (template) => {
  let level = 0
  for (const match of String(template || '').matchAll(HEADING_PLACEHOLDER)) {
    level = Math.max(level, Number(match[1]))
  }
  return level
}

/**
 * An empty template means "show nothing", and is different from having no template at all.
 *
 * A profile whose template the user cleared used to fall through to the default and put the number
 * back, so there was no way to have a block counted but not labelled. Only null or undefined - no
 * template set - falls back now.
 */
export const applyTemplate = (
  template,
  number,
  defaultLabel,
  title = '',
  headingCounters = [],
) => {
  if (template === '') {
    return ''
  }
  if (!template) {
    return `${defaultLabel} ${number}`.trim()
  }
  return template
    .replace(HEADING_PLACEHOLDER, (_, level) =>
      String(headingCounters[Number(level) - 1] || 0),
    )
    .replaceAll('{number}', number)
    .replaceAll('{label}', defaultLabel)
    .replaceAll('{title}', title)
}

export const getReferenceLabel = (
  targetType,
  number,
  {
    labels = DEFAULT_REFERENCE_LABELS,
    styles = {},
    templates = {},
    title = '',
    enabled = true,
  } = {},
) => {
  if (!enabled) {
    return ''
  }
  if (targetType === 'citation') {
    return `[${number}]`
  }
  const defaultLabel = labels[targetType] || targetType
  const template = templates[targetType] || DEFAULT_TEMPLATES[targetType] || '{label} {number}'
  const style = styles[targetType] || 'numeric'
  const formattedNumber = formatSingleNumber(number, style)
  return applyTemplate(template, targetType === 'heading' ? number : formattedNumber, defaultLabel, title)
}

const createUniqueId = (targetType, seenIds, createId) => {
  const prefix = targetType === 'figure' ? 'figure' : targetType
  let attempt = 0
  while (attempt < 100) {
    const suffix = normalizeText(createId())
    const candidate = `${prefix}-${suffix || attempt + 1}`
    if (!seenIds.has(candidate)) {
      return candidate
    }
    attempt += 1
  }
  return `${prefix}-${seenIds.size + 1}`
}

const findProfile = (descriptor, profiles = []) => {
  if (!Array.isArray(profiles) || profiles.length === 0) return null
  if (descriptor.numberingProfileId) {
    // A block that names a profile keeps that assignment even when the profile is not in the list.
    // Falling through to the default for its type used to overwrite the block's own choice, and a
    // list that is momentarily incomplete - one profile just deleted, a document still loading - was
    // enough to move every block in the document onto one profile, permanently.
    return profiles.find((p) => p.id === descriptor.numberingProfileId) || null
  }
  if (descriptor.targetType === 'heading') {
    return (
      profiles.find(
        (p) => p.targetType === 'heading' && p.level === descriptor.level,
      ) || profiles.find((p) => p.targetType === 'heading' && !p.level)
    )
  }
  return profiles.find((p) => p.targetType === descriptor.targetType)
}

export const buildReferencePlan = (
  descriptors,
  {
    createId,
    labels = DEFAULT_REFERENCE_LABELS,
    styles = {},
    templates = {},
    enabled = true,
    profiles = [],
  } = {},
) => {
  const idFactory =
    typeof createId === 'function'
      ? createId
      : (() => {
          let count = 0
          return () => {
            count += 1
            return String(count)
          }
        })()
  const headingCounters = [0, 0, 0, 0, 0, 0]
  // One sequence per profile, not per node type. A paragraph carrying the figure profile has to
  // count as a figure; keying by node type is what numbered such a caption "Figure 6" - the sixth
  // paragraph - instead of the first figure.
  const counters = new Map()
  const scopeKeys = new Map()
  const seenIds = new Set()
  const updates = []
  const targets = []

  for (const descriptor of descriptors) {
    const { targetType } = descriptor
    if (!REFERENCE_TARGET_TYPES.includes(targetType)) {
      continue
    }

    const requestedId = normalizeText(descriptor.targetId)
    const targetId =
      requestedId && !seenIds.has(requestedId)
        ? requestedId
        : createUniqueId(targetType, seenIds, idFactory)
    seenIds.add(targetId)

    // The profile is read here and never written to. Filling the profile's empty fields from the
    // block being scanned made one block's font, margin or alignment the profile's own, and the
    // stylesheet then handed it to every other block that follows that profile.
    const profile = findProfile(descriptor, profiles)
    // A block naming a profile that is not in the list is left alone rather than numbered under the
    // defaults, which would put a label on it that no profile asked for.
    const profileMissing = !profile && Boolean(normalizeText(descriptor.numberingProfileId))
    const profileEnabled = profileMissing
      ? false
      : profile
        ? profile.enabled !== false
        : enabled !== false

    let number
    if (targetType === 'heading') {
      // A heading whose profile does not number it takes no number and does not consume one, so the
      // next numbered heading at that level carries on where the last numbered one left off. It also
      // leaves the deeper levels alone, since it opens no section as far as the count is concerned.
      //
      // A heading inside a table is the same case arrived at differently: it is a styled cell rather
      // than a section, so it opens nothing and must not take the number belonging to the chapter
      // after it. Before this, a three column review table spent a section number on every cell.
      if (descriptor.inTable || !profileEnabled) {
        number = ''
      } else {
        const headingStyle =
          descriptor.numberStyle ||
          (profile ? profile.style : styles.heading) ||
          'numeric'
        number = getNextHeadingNumber(headingCounters, descriptor.level, {
          style: headingStyle,
        })
      }
    } else if (CONTAINER_TARGET_TYPES.has(targetType)) {
      number = ''
    } else {
      const counterKey = profile ? profile.id : targetType
      const template =
        descriptor.numberTemplate ||
        (profile ? profile.template : templates[targetType]) ||
        DEFAULT_TEMPLATES[targetType] ||
        ''
      // A template that names a heading level restarts its sequence whenever that heading changes.
      const scopeLevel = templateScopeLevel(template)
      const scopeKey =
        scopeLevel > 0 ? headingCounters.slice(0, scopeLevel).join('.') : ''
      if (scopeKeys.get(counterKey) !== scopeKey) {
        scopeKeys.set(counterKey, scopeKey)
        counters.set(counterKey, 0)
      }
      counters.set(counterKey, (counters.get(counterKey) || 0) + 1)
      const style =
        descriptor.numberStyle ||
        (profile ? profile.style : styles[targetType]) ||
        'numeric'
      number = formatSingleNumber(counters.get(counterKey), style)
    }

    const title = normalizeText(descriptor.title)
    const defaultLabel = labels[targetType] || targetType
    // The profile is the source of truth for its own blocks, including when it says "nothing". The
    // node attribute is only a fallback for a block that follows no profile; letting it win meant a
    // template cleared on the profile stayed visible on every block that had already been synced.
    const profileTemplate = profile ? profile.template : undefined
    const template =
      profileTemplate !== undefined && profileTemplate !== null
        ? profileTemplate
        : descriptor.numberTemplate ||
          templates[targetType] ||
          DEFAULT_TEMPLATES[targetType] ||
          '{label} {number}'

    const label =
      profileEnabled && !CONTAINER_TARGET_TYPES.has(targetType)
        ? applyTemplate(template, number, defaultLabel, title, headingCounters)
        : ''

    const target = {
      pos: descriptor.pos,
      targetId,
      targetType,
      number,
      label,
      title,
      enabled: profileEnabled,
      numberingProfileId: CONTAINER_TARGET_TYPES.has(targetType)
        ? null
        : profile
          ? profile.id
          : descriptor.numberingProfileId,
      clearProfile: CONTAINER_TARGET_TYPES.has(targetType),
      profile: CONTAINER_TARGET_TYPES.has(targetType) ? null : profile,
    }
    targets.push(target)
    updates.push({
      ...target,
      idChanged: targetId !== requestedId,
      numberChanged: String(descriptor.number || '') !== number,
      labelChanged: String(descriptor.label || '') !== label,
    })
  }

  return { targets, updates }
}

/**
 * A label carries its own layout; a reference to it does not.
 *
 * A heading template may end in a newline - `BAB {number}\n` is the default for level 1, and that
 * newline is what puts the title on the line below the chapter number. A cross-reference to that
 * heading is a few words inside someone's sentence, and it was carrying the newline with it, so
 * writing "see BAB I for details" broke the line in the middle. The label the reader follows is the
 * text, not the shape the heading gives it.
 */
const asReferenceText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

export const getCrossReferenceText = (
  target,
  displayMode = 'label',
  labels = DEFAULT_REFERENCE_LABELS,
) => {
  if (!target) {
    return labels.missing
  }
  const mode = REFERENCE_DISPLAY_MODES.includes(displayMode)
    ? displayMode
    : 'label'
  const label = asReferenceText(target.label)
  const title = asReferenceText(target.title)
  const effectiveLabel = label || (title || labels.missing)
  if (mode === 'title') {
    return title || effectiveLabel
  }
  if (mode === 'label-title') {
    return title && label ? `${label}: ${title}` : title || label || labels.missing
  }
  return effectiveLabel
}

export const getReferenceTargetOptionLabel = (target) =>
  target.title && target.label
    ? `${target.label}: ${target.title}`
    : target.title || target.label || target.targetId
