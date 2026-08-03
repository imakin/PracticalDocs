export const DOCUMENT_FILE_FORMAT = 'umodoc'
export const DOCUMENT_FILE_VERSION = 1

export class DocumentFileError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DocumentFileError'
    this.code = code
  }
}

const fail = (code, message) => {
  throw new DocumentFileError(code, message)
}

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const requireRecord = (value, path) => {
  if (!isRecord(value)) {
    fail('invalidFile', `"${path}" must be an object.`)
  }
  return value
}

const requireString = (value, path, { allowEmpty = true } = {}) => {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    fail('invalidFile', `"${path}" must be a string.`)
  }
  return value
}

const requireNumber = (value, path, minimum, exclusive = false) => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (exclusive ? value <= minimum : value < minimum)
  ) {
    const comparison = exclusive ? 'greater than' : 'at least'
    fail('invalidFile', `"${path}" must be ${comparison} ${minimum}.`)
  }
  return value
}

const requireBoolean = (value, path) => {
  if (typeof value !== 'boolean') {
    fail('invalidFile', `"${path}" must be a boolean.`)
  }
  return value
}

const requireEnum = (value, path, values) => {
  if (!values.includes(value)) {
    fail('invalidFile', `"${path}" has an unsupported value.`)
  }
  return value
}

const validateLabel = (value) => {
  if (typeof value === 'string') {
    return value
  }
  const label = requireRecord(value, 'page.size.label')
  const normalized = {}
  for (const key of ['en_US', 'zh_CN']) {
    if (label[key] !== undefined) {
      normalized[key] = requireString(label[key], `page.size.label.${key}`)
    }
  }
  if (Object.keys(normalized).length === 0) {
    fail('invalidFile', '"page.size.label" must contain a locale label.')
  }
  return normalized
}

const validateContent = (value) => {
  const content = requireRecord(value, 'content')
  if (content.type !== 'doc' || !Array.isArray(content.content)) {
    fail(
      'invalidContent',
      '"content" must be a Tiptap document with a content array.',
    )
  }
  return content
}

const validatePage = (value) => {
  const page = requireRecord(value, 'page')
  const size = requireRecord(page.size, 'page.size')
  const margin = requireRecord(page.margin, 'page.margin')
  const watermark = requireRecord(page.watermark, 'page.watermark')
  const fontFamily =
    watermark.fontFamily === null
      ? null
      : requireString(watermark.fontFamily, 'page.watermark.fontFamily')
  const alpha = requireNumber(watermark.alpha, 'page.watermark.alpha', 0)
  if (alpha > 1) {
    fail('invalidFile', '"page.watermark.alpha" must not exceed 1.')
  }
  const watermarkText = requireString(watermark.text, 'page.watermark.text')
  if (watermarkText.length > 30) {
    fail('invalidFile', '"page.watermark.text" must not exceed 30 characters.')
  }

  return {
    layout: requireEnum(page.layout, 'page.layout', ['page', 'web']),
    size: {
      label: validateLabel(size.label),
      width: requireNumber(size.width, 'page.size.width', 0, true),
      height: requireNumber(size.height, 'page.size.height', 0, true),
    },
    margin: {
      left: requireNumber(margin.left, 'page.margin.left', 0),
      right: requireNumber(margin.right, 'page.margin.right', 0),
      top: requireNumber(margin.top, 'page.margin.top', 0),
      bottom: requireNumber(margin.bottom, 'page.margin.bottom', 0),
    },
    orientation: requireEnum(page.orientation, 'page.orientation', [
      'portrait',
      'landscape',
    ]),
    background: requireString(page.background, 'page.background'),
    watermark: {
      type: requireEnum(watermark.type, 'page.watermark.type', [
        'compact',
        'spacious',
      ]),
      alpha,
      fontColor: requireString(watermark.fontColor, 'page.watermark.fontColor'),
      fontSize: requireNumber(
        watermark.fontSize,
        'page.watermark.fontSize',
        0,
        true,
      ),
      fontFamily,
      fontWeight: requireEnum(
        watermark.fontWeight,
        'page.watermark.fontWeight',
        ['normal', 'bold', 'bolder'],
      ),
      text: watermarkText,
    },
    showBreakMarks: requireBoolean(page.showBreakMarks, 'page.showBreakMarks'),
    showLineNumber: requireBoolean(page.showLineNumber, 'page.showLineNumber'),
    showBookmark: requireBoolean(page.showBookmark, 'page.showBookmark'),
    showToc: requireBoolean(page.showToc, 'page.showToc'),
  }
}

export const validateDocumentSnapshot = (value) => {
  const snapshot = requireRecord(value, 'root')
  if (snapshot.format !== DOCUMENT_FILE_FORMAT) {
    fail('unknownFormat', 'This is not a Umo Editor document.')
  }
  if (
    !Number.isInteger(snapshot.formatVersion) ||
    snapshot.formatVersion !== DOCUMENT_FILE_VERSION
  ) {
    fail(
      'unsupportedVersion',
      `Document format version ${String(snapshot.formatVersion)} is unsupported.`,
    )
  }

  const editorVersion = requireString(snapshot.editorVersion, 'editorVersion', {
    allowEmpty: false,
  })
  const savedAt = requireString(snapshot.savedAt, 'savedAt', {
    allowEmpty: false,
  })
  if (Number.isNaN(Date.parse(savedAt))) {
    fail('invalidFile', '"savedAt" must be a valid ISO 8601 date.')
  }

  const document = requireRecord(snapshot.document, 'document')
  const title = requireString(document.title, 'document.title')
  const profiles = Array.isArray(snapshot.profiles) ? snapshot.profiles : []

  return {
    format: DOCUMENT_FILE_FORMAT,
    formatVersion: DOCUMENT_FILE_VERSION,
    editorVersion,
    savedAt,
    document: { title },
    content: validateContent(snapshot.content),
    page: validatePage(snapshot.page),
    profiles,
  }
}

export const createDocumentSnapshot = ({
  content,
  document,
  page,
  profiles,
  editorVersion,
  savedAt = new Date().toISOString(),
}) =>
  validateDocumentSnapshot({
    format: DOCUMENT_FILE_FORMAT,
    formatVersion: DOCUMENT_FILE_VERSION,
    editorVersion,
    savedAt,
    document: {
      title: document?.title ?? '',
    },
    content,
    page,
    profiles,
  })

export const parseDocumentFile = (source) => {
  let value
  try {
    value = JSON.parse(source)
  } catch {
    fail('invalidJson', 'The selected file is not valid JSON.')
  }
  return validateDocumentSnapshot(value)
}

export const serializeDocumentSnapshot = (snapshot) =>
  JSON.stringify(validateDocumentSnapshot(snapshot), null, 2)

export const findBlobUrls = (value) => {
  const urls = new Set()
  const visit = (item) => {
    if (typeof item === 'string') {
      if (item.startsWith('blob:')) {
        urls.add(item)
      }
      return
    }
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (isRecord(item)) {
      Object.values(item).forEach(visit)
    }
  }
  visit(value)
  return [...urls]
}

export const getDocumentFileName = (title, fallback = 'Untitled Document') => {
  let name = String(title || fallback)
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\p{Cc}/gu, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 120)

  name = name.replace(/\.umodoc\.json$/i, '')
  if (!name) {
    name = fallback
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) {
    name = `_${name}`
  }
  return `${name}.umodoc.json`
}
