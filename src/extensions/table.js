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
    this.table.classList.add('umo-node-table')
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
        class: 'umo-node-table',
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
