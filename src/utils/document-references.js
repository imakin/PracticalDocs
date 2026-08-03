export const REFERENCE_TARGET_TYPES = ['heading', 'figure', 'table', 'citation']

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

export const applyTemplate = (template, number, defaultLabel, title = '') => {
  if (!template) {
    return `${defaultLabel} ${number}`.trim()
  }
  return template
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
    const matched = profiles.find((p) => p.id === descriptor.numberingProfileId)
    if (matched) return matched
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
  const counters = {
    figure: 0,
    table: 0,
    citation: 0,
  }
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

    const profile = findProfile(descriptor, profiles)
    const profileEnabled = profile
      ? profile.enabled !== false
      : enabled !== false

    let number
    if (targetType === 'heading') {
      const headingStyle =
        descriptor.numberStyle ||
        (profile ? profile.style : styles.heading) ||
        'numeric'
      number = getNextHeadingNumber(headingCounters, descriptor.level, {
        style: headingStyle,
      })
    } else {
      counters[targetType] += 1
      const style =
        descriptor.numberStyle ||
        (profile ? profile.style : styles[targetType]) ||
        'numeric'
      number = formatSingleNumber(counters[targetType], style)
    }

    const title = normalizeText(descriptor.title)
    const defaultLabel = labels[targetType] || targetType
    const template =
      descriptor.numberTemplate ||
      (profile ? profile.template : templates[targetType]) ||
      DEFAULT_TEMPLATES[targetType] ||
      '{label} {number}'

    const label = profileEnabled
      ? applyTemplate(template, number, defaultLabel, title)
      : ''

    const target = {
      pos: descriptor.pos,
      targetId,
      targetType,
      number,
      label,
      title,
      enabled: profileEnabled,
      numberingProfileId: profile ? profile.id : descriptor.numberingProfileId,
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
  const effectiveLabel =
    target.label || (target.title ? target.title : labels.missing)
  if (mode === 'title') {
    return target.title || effectiveLabel
  }
  if (mode === 'label-title') {
    return target.title && target.label
      ? `${target.label}: ${target.title}`
      : target.title || target.label || labels.missing
  }
  return effectiveLabel
}

export const getReferenceTargetOptionLabel = (target) =>
  target.title && target.label
    ? `${target.label}: ${target.title}`
    : target.title || target.label || target.targetId
