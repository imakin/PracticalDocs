import { mergeAttributes } from '@tiptap/core'
import { createColGroup, Table, TableView } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table/cell'
import { TableHeader } from '@tiptap/extension-table/header'
import { TableRow } from '@tiptap/extension-table/row'

/**
 * A table carries its reference identity as attributes only.
 *
 * It used to also carry a `<caption>` element holding `label: caption`, composed by the editor. That
 * text was not the user's: the label came from the numbering profile and the element was not
 * editable in place, so there was no way to correct or remove it from the page. It also could not
 * survive a save. The table schema is `tableRow+` and nothing parses `<caption>`, so on reopening the
 * file ProseMirror had to fit that text somewhere and wrapped it into a row of its own - one more row
 * on every save and load. A caption is now written the way any other text is, as a block above or
 * below the table, styled and numbered by a profile.
 */
class ReferenceTableView extends TableView {
  constructor(node, cellMinWidth) {
    super(node, cellMinWidth)
    this.updateReferenceAttributes(node)
  }

  updateReferenceAttributes(node) {
    const { referenceId, referenceLabel, referenceNumber } = node.attrs
    const attributes = {
      'data-reference-id': referenceId,
      'data-reference-label': referenceLabel,
      'data-reference-number': referenceNumber,
    }
    Object.entries(attributes).forEach(([name, value]) => {
      if (value) {
        this.table.setAttribute(name, value)
      } else {
        this.table.removeAttribute(name)
      }
    })
    this.table.classList.add('pdoc-node-table')
  }

  update(node) {
    if (!super.update(node)) {
      return false
    }
    this.updateReferenceAttributes(node)
    return true
  }
}

// 扩展表格能力
const CustomTable = Table.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      HTMLAttributes: {
        class: 'pdoc-node-table',
      },
      allowTableNodeSelection: true,
      resizable: true,
      View: ReferenceTableView,
    }
  },
  /**
   * Drop any `<caption>` a stored document still carries.
   *
   * Without this the text inside it is parsed as table content, and since the table accepts only
   * rows, ProseMirror wraps it into one. Documents written before captions were removed would grow a
   * row every time they were opened. An `ignore` rule keeps its own name in ProseMirror's schema
   * rules rather than being bound to this node, so the element is skipped wherever it appears.
   */
  parseHTML() {
    return [...(this.parent?.() ?? []), { tag: 'caption', ignore: true }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const { colgroup, tableWidth, tableMinWidth } = createColGroup(
      node,
      this.options.cellMinWidth,
    )
    const userStyles = HTMLAttributes.style
    const style =
      userStyles ||
      (tableWidth ? `width: ${tableWidth}` : `min-width: ${tableMinWidth}`)
    const table = [
      'table',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { style }),
      colgroup,
      ['tbody', 0],
    ]
    return this.options.renderWrapper
      ? ['div', { class: 'tableWrapper' }, table]
      : table
  },
})

/**
 * Each side of a cell, on its own.
 *
 * A table in a thesis is rarely the grid the editor draws by default. The usual house style rules a
 * line above and below and nothing else, and an equation is written as a table whose borders are all
 * off, with the number in a cell of its own - which is what the writer was reaching for when they
 * asked for this.
 *
 * Held as four CSS values rather than a set of flags, because a flag cannot say what the line looks
 * like and the writer will want a thick rule above a total and a hairline between rows. `null` means
 * the side is left to the stylesheet, which is what an untouched table keeps doing.
 *
 * Written as an inline style and read back from one, exactly as `background` and `color` beside them
 * are. That is what carries them into the saved file and into the exported PDF, both of which take
 * the cell's own markup: nothing else in this editor would have to be taught about them.
 *
 * Read back through the CSSOM rather than by matching the text, because the browser rewrites what it
 * was given. Four sides all set to `none` come back out of a cell as
 * `border-width: medium; border-style: none; border-color: currentcolor` - the shorthand, with not
 * one of the four longhands left to match. A pattern looking for `border-top:` found nothing, so a
 * borderless table drew its full grid again the moment it was reopened. The test caught it; the eye
 * would not have, because the table looked right until it was saved.
 */
const sideOf = (element, name) => {
  const style = element.getAttribute('style')
  if (!style || typeof document === 'undefined') {
    return null
  }
  // A detached element, so the browser resolves whatever shorthand it was given into the side
  // actually asked for, without the document having to hold it.
  const probe = document.createElement('div')
  probe.setAttribute('style', style)
  // The three longhands, not the side's own shorthand: asking for `borderTop` comes back empty
  // whenever the browser cannot serialise it in one piece, which is exactly the case this has to
  // read - a cell whose four sides were all turned off comes back as
  // `border-width: medium; border-style: none; border-color: currentcolor`.
  const line = probe.style[`${name}Style`]
  if (!line) {
    return null
  }
  if (line === 'none' || line === 'hidden') {
    return line
  }
  const width = probe.style[`${name}Width`] || 'medium'
  const colour = probe.style[`${name}Color`]
  return colour ? `${width} ${line} ${colour}` : `${width} ${line}`
}

const SIDES = [
  ['borderTop', 'border-top'],
  ['borderRight', 'border-right'],
  ['borderBottom', 'border-bottom'],
  ['borderLeft', 'border-left'],
]

const borderAttributes = () =>
  Object.fromEntries(
    SIDES.map(([name, property]) => [
      name,
      {
        default: null,
        parseHTML: (element) => sideOf(element, name),
        renderHTML: (attributes) => {
          const value = attributes[name]
          return value ? { style: `${property}: ${value}` } : {}
        },
      },
    ]),
  )

// 扩展单元格
const TableCellOptions = {
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: (element) => element.getAttribute('align') || null,
        renderHTML: ({ align }) => ({ align }),
      },
      background: {
        default: null,
        parseHTML: (element) => {
          const style = element.getAttribute('style') || ''
          const match = style.match(/background(?:-color)?:\s*([^;]+)/i)
          return match ? match[1].trim() : null
        },
        renderHTML: ({ background }) => {
          return background ? { style: `background-color: ${background}` } : {}
        },
      },
      color: {
        default: null,
        parseHTML: (element) => {
          const style = element.getAttribute('style') || ''
          const match = style.match(/(?<!background-)color:\s*([^;]+)/i)
          if (style.includes('background-color')) return null
          return match ? match[1].trim() : null
        },
        renderHTML: ({ color }) => {
          return color ? { style: `color: ${color}` } : {}
        },
      },
      ...borderAttributes(),
    }
  },
}

const CustomTableHeader = TableHeader.extend(TableCellOptions)
const CustomTableCell = TableCell.extend(TableCellOptions)

export {
  CustomTable as Table,
  CustomTableCell as TableCell,
  CustomTableHeader as TableHeader,
  TableRow,
}
