/**
 * Sections: the runs of pages that share one page geometry.
 *
 * A page break both closes the section before it and opens the next, so the sections of a document
 * are the runs of top level blocks between page breaks. The first section begins at the start of the
 * document and takes its geometry from the document settings; every later one takes its geometry
 * from the page break that opened it.
 *
 * Every field on a break is optional, and a field left unset carries on from the section before it -
 * the same rule the numbering section already follows, so a document that never sets a second
 * geometry behaves exactly as it did when there was only one.
 *
 * Relative imports only: this module is unit tested under plain Node, which has no '@/' alias.
 */

// What a section can change. Anything not named here is a document wide setting.
export const SECTION_GEOMETRY_FIELDS = ['size', 'orientation', 'margin']

export const PAGE_ORIENTATIONS = ['portrait', 'landscape']

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const positiveNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

const notNegative = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * A size a section can actually be drawn at, or null.
 *
 * The label is carried through untouched because it is what the size menu shows as active; it is
 * never used as a measurement.
 */
export const normalizeSectionSize = (value) => {
  if (!isRecord(value)) {
    return null
  }
  const width = positiveNumber(value.width)
  const height = positiveNumber(value.height)
  if (width === null || height === null) {
    return null
  }
  return value.label === undefined
    ? { width, height }
    : { label: value.label, width, height }
}

export const normalizeSectionMargin = (value) => {
  if (!isRecord(value)) {
    return null
  }
  const out = {}
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const n = notNegative(value[side])
    if (n === null) {
      return null
    }
    out[side] = n
  }
  // The name of the preset the four numbers came from, if they came from one. Carried rather than
  // measured, so that reopening the dialog shows the preset the user picked rather than "custom".
  if (typeof value.layout === 'string') {
    out.layout = value.layout
  }
  return out
}

export const normalizeSectionOrientation = (value) =>
  PAGE_ORIENTATIONS.includes(value) ? value : null

/**
 * The geometry a section actually renders at, after inheritance.
 *
 * `breaks` are the page breaks in document order, each `{ id, pos, size, orientation, margin }` with
 * every geometry field optional. `page` is the document settings, which is the first section's
 * geometry and the fallback for every field no break has ever set.
 *
 * The returned sections are in document order and always at least one long: a document with no page
 * break is a single section covering all of it.
 */
export const resolveSections = (breaks, page) => {
  const base = {
    size: normalizeSectionSize(page?.size) ?? { width: 21, height: 29.7 },
    orientation: normalizeSectionOrientation(page?.orientation) ?? 'portrait',
    margin: normalizeSectionMargin(page?.margin) ?? {
      top: 2.54,
      right: 2.54,
      bottom: 2.54,
      left: 2.54,
    },
  }

  const list = Array.isArray(breaks) ? breaks : []
  const sections = [
    {
      index: 0,
      // The first section is opened by the document itself, not by a break, and it is the document
      // settings that it writes to. Both nulls are read by the menus to say so.
      openedBy: null,
      openedAt: null,
      closedBy: list[0]?.id ?? null,
      startPos: 0,
      ...base,
    },
  ]

  let active = base
  list.forEach((item, index) => {
    active = {
      size: normalizeSectionSize(item?.size) ?? active.size,
      orientation:
        normalizeSectionOrientation(item?.orientation) ?? active.orientation,
      margin: normalizeSectionMargin(item?.margin) ?? active.margin,
    }
    sections.push({
      index: index + 1,
      openedBy: item?.id ?? null,
      openedAt: typeof item?.pos === 'number' ? item.pos : null,
      closedBy: list[index + 1]?.id ?? null,
      startPos: typeof item?.pos === 'number' ? item.pos : null,
      ...active,
    })
  })
  return sections
}

/**
 * The sheet a section is drawn at, in cm.
 *
 * Orientation is a property of the section rather than of the size, so a landscape section keeps the
 * same paper and turns it. This is the same swap the page container does; it lives here so there is
 * one answer to it.
 */
export const sheetSizeOf = (section) => {
  const width = section?.size?.width ?? 0
  const height = section?.size?.height ?? 0
  return section?.orientation === 'landscape'
    ? { width: height, height: width }
    : { width, height }
}

/** The widest sheet in the document, which is how wide the canvas has to be. */
export const widestSheet = (sections) =>
  (Array.isArray(sections) ? sections : []).reduce(
    (widest, section) => Math.max(widest, sheetSizeOf(section).width),
    0,
  )

/** Which section a top level document position falls in. */
export const sectionIndexAt = (sections, pos) => {
  const list = Array.isArray(sections) ? sections : []
  let found = 0
  for (const section of list) {
    if (section.startPos !== null && section.startPos <= pos) {
      found = section.index
    }
  }
  return found
}

/**
 * Whether two sections would be drawn identically.
 *
 * Used to keep the engine from redrawing a canvas that has not changed, and to tell a user that a
 * change they made had no effect because the section already looked like that.
 */
export const sameGeometry = (a, b) => {
  if (!a || !b) {
    return a === b
  }
  const sizeA = sheetSizeOf(a)
  const sizeB = sheetSizeOf(b)
  return (
    sizeA.width === sizeB.width &&
    sizeA.height === sizeB.height &&
    a.margin.top === b.margin.top &&
    a.margin.right === b.margin.right &&
    a.margin.bottom === b.margin.bottom &&
    a.margin.left === b.margin.left
  )
}

/**
 * The horizontal inset each section's blocks need, in cm, relative to the first section.
 *
 * The editor is one column and the printed document is one flow, so a section drawn on different
 * paper cannot be given a column of its own - each of its blocks is given the difference instead.
 * The difference is from the **first** section, because that is the one the column is already laid
 * out for, so a document whose sections are all the same produces nothing but zeroes.
 *
 * `centred` is the difference between the two callers, and it is only about **where** the surplus
 * width goes, never how much of it there is. On screen the sheets share one canvas as wide as the
 * widest, and a narrower sheet is centred in it, so half the surplus sits on each side. In print
 * each page is its own paper whose left edge is the canvas's left edge, so the whole surplus goes on
 * the right.
 *
 * Both leave the block the same width, which is the point: the export measures the screen layout to
 * place its page bands, so a block that broke its lines differently in the two would put every band
 * on the wrong page.
 */
export const sectionInsets = (sections, { centred = true } = {}) => {
  const list = Array.isArray(sections) ? sections : []
  const canvas = widestSheet(list)
  const base = list[0]
    ? { left: list[0].margin.left, right: list[0].margin.right }
    : { left: 0, right: 0 }
  // Rounded to a hundredth of a centimetre, which is finer than a printer resolves, so that a
  // difference of a rounding error is not treated as a difference at all.
  const round = (value) => Math.round((value - Number.EPSILON) * 100) / 100
  return list.map((section) => {
    const surplus = canvas - sheetSizeOf(section).width
    return {
      left: round(
        (centred ? surplus / 2 : 0) + section.margin.left - base.left,
      ),
      right: round(
        (centred ? surplus / 2 : surplus) + section.margin.right - base.right,
      ),
    }
  })
}
