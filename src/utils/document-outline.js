/**
 * What the editor already knows about its own structure, in the shape a PDF outline wants.
 *
 * Nothing here computes anything: the headings come from the same list the contents is built from,
 * the numbers are read off the rendered heading, and the page comes from the pagination engine. One
 * source for each fact, so a bookmark cannot disagree with the contents or with the folio printed on
 * the page.
 */
import { pageOfElement } from '@/extensions/pagination'
import { sectionHeadings } from '@/utils/heading-scope'

const headingElement = (editor, id) => {
  if (!id || typeof document === 'undefined') return null
  return editor?.view?.dom?.querySelector(`[data-toc-id="${id}"]`) || null
}

/**
 * The number a heading carries, if its profile gives it one - `BAB I`, `1.1`.
 *
 * Read from the rendered decoration rather than recomputed, exactly as the contents reads it. A
 * template with a newline renders over two lines; a bookmark is one line, so the break becomes a
 * space.
 */
const headingNumber = (element) => {
  const number = element?.querySelector('.pdoc-heading-number')
  return (number?.textContent || '').replace(/\s+/g, ' ').trim()
}

/**
 * The title without the number, since the number is added back deliberately.
 *
 * `textContent` from the contents extension is the heading's own text and does not include the
 * decoration, which is a widget rather than document content - but a heading whose number was typed
 * by hand would carry it, and stripping a leading copy costs nothing.
 */
const headingTitle = (item, number) => {
  const text = String(item?.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (number && text.startsWith(number)) return text.slice(number.length).trim()
  return text
}

/**
 * Every heading, with the physical page it is on.
 *
 * **Physical**, not the folio: a PDF outline destination is a page index, and the folio restarts,
 * changes numerals and can be hidden. The contents shows the folio and this shows the index, and
 * both come from `pageOfElement` so they cannot drift apart.
 */
export const collectOutlineEntries = (editor) => {
  // Sections only: a heading inside a table is a styled cell, and a bookmark pointing at one is
  // no more use to a reader of the PDF than an entry in the contents was.
  const items = sectionHeadings(editor)
  if (items.length === 0) return []
  const entries = []
  for (const item of items) {
    const element = headingElement(editor, item.id)
    if (!element) continue
    const page = pageOfElement(editor, element)
    const number = headingNumber(element)
    entries.push({
      level: Number(item.originalLevel) || 1,
      number,
      title: headingTitle(item, number),
      page: page ? page.index : 1,
    })
  }
  return entries
}

export const collectPageRecords = (editor) => {
  const storage = editor?.extensionStorage?.pagination || editor?.storage?.pagination
  return Array.isArray(storage?.pages) ? storage.pages : []
}

export const documentPageCount = (editor) => collectPageRecords(editor).length
