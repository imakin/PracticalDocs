// Page numbering is computed here, not by CSS.
//
// A page carries two numbers and they are not the same thing.
//
//   index  the physical page, 1..N, never restarted. The PDF outline and page navigation use it.
//   text   what is printed in the footer: restartable, re-formattable, hideable, purely visual.
//
// A thesis whose body restarts at 1 still has its BAB I bookmark pointing at physical page 9. Mixing
// the two would break navigation in every PDF reader.
//
// Chrome's `@page` margin boxes can place a number and format it, but they cannot restart a count:
// `counter-reset: page N` is ignored on an element, and inside an `@page` rule it re-applies to every
// page that rule matches, so the number freezes. A thesis needs roman front matter and then a restart
// at 1, so the numbers are worked out here and placed by the engine. See ADR 0008.

// Relative, not the '@/' alias: this module is unit tested under plain Node, which has no alias.
import { formatSingleNumber } from './document-references.js'

export const PAGE_NUMBER_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

// Deliberately the same names the numbering profiles use, so a user meets one vocabulary.
export const PAGE_NUMBER_FORMATS = [
  'numeric',
  'roman-upper',
  'roman-lower',
  'alpha-upper',
  'alpha-lower',
]

export const defaultPageNumberSettings = () => ({
  enabled: false,
  position: 'bottom-center',
  format: 'numeric',
  template: '{number}',
  startAt: 1,
})

const normalizePosition = (value, fallback) =>
  PAGE_NUMBER_POSITIONS.includes(value) ? value : fallback

const normalizeFormat = (value, fallback) =>
  PAGE_NUMBER_FORMATS.includes(value) ? value : fallback

const normalizeStart = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export const applyPageTemplate = (template, number, total) =>
  String(template ?? '{number}')
    .replaceAll('{number}', String(number))
    .replaceAll('{total}', String(total))

/**
 * Work out what each sheet shows.
 *
 * `sections` are the numbering changes the user anchored on page breaks, as
 * `{ atSheet, enabled?, position?, format?, template?, startAt? }`. `atSheet` is the index of the
 * sheet the section opens. A field left undefined or null carries on from the section before it, so a
 * section that only changes the format keeps the position and the running count.
 *
 * `startAt` is the one field that is not merely inherited: a number restarts the count there, and
 * leaving it out means the count continues across the boundary.
 */
export const computePageNumbers = (sheetCount, settings = {}, sections = []) => {
  const base = { ...defaultPageNumberSettings(), ...(settings || {}) }
  const total = Math.max(0, Math.trunc(Number(sheetCount) || 0))
  if (total === 0) {
    return []
  }

  const bySheet = new Map()
  for (const section of Array.isArray(sections) ? sections : []) {
    const at = Math.trunc(Number(section?.atSheet))
    // A section opening before the first sheet or past the last one has nothing to describe.
    if (!Number.isFinite(at) || at <= 0 || at >= total) continue
    bySheet.set(at, section)
  }

  let active = {
    enabled: base.enabled !== false,
    position: normalizePosition(base.position, 'bottom-center'),
    format: normalizeFormat(base.format, 'numeric'),
    template: base.template ?? '{number}',
  }
  let counter = normalizeStart(base.startAt) ?? 1

  const out = []
  for (let sheet = 0; sheet < total; sheet += 1) {
    const section = bySheet.get(sheet)
    if (section) {
      active = {
        enabled: section.enabled === undefined || section.enabled === null
          ? active.enabled
          : section.enabled !== false,
        position: normalizePosition(section.position, active.position),
        format: normalizeFormat(section.format, active.format),
        template:
          section.template === undefined || section.template === null
            ? active.template
            : section.template,
      }
      const restart = normalizeStart(section.startAt)
      if (restart !== null) {
        counter = restart
      }
    }
    out.push({
      // The physical page, counted from 1 and never restarted. This is what a PDF reader's outline
      // and page navigation use, and what a printed stack of paper actually is. Restarting it would
      // break navigation, which is why the two numbers are kept apart.
      sheet,
      index: sheet + 1,
      visible: active.enabled,
      position: active.position,
      // The number the reader sees in the footer. Purely presentational: it restarts, changes
      // numeral system and can be hidden without any of that affecting `index`.
      value: counter,
      text: applyPageTemplate(
        active.template,
        formatSingleNumber(counter, active.format),
        total,
      ),
    })
    counter += 1
  }
  return out
}
