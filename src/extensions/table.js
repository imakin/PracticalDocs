import { mergeAttributes } from '@tiptap/core'
import { createColGroup, Table, TableView } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table/cell'
import { TableHeader } from '@tiptap/extension-table/header'
import { TableRow } from '@tiptap/extension-table/row'

class ReferenceTableView extends TableView {
  constructor(node, cellMinWidth) {
    super(node, cellMinWidth)
    this.caption = document.createElement('caption')
    this.caption.className = 'umo-node-table-caption'
    this.caption.contentEditable = 'false'
    this.table.insertBefore(this.caption, this.colgroup)
    this.updateReferenceAttributes(node)
  }

  updateReferenceAttributes(node) {
    const { caption, referenceId, referenceLabel, referenceNumber } = node.attrs
    const captionText = String(caption || '').trim()
    this.caption.textContent = captionText
      ? `${referenceLabel}: ${captionText}`
      : referenceLabel || ''

    const attributes = {
      'data-caption': captionText,
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
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-caption') ||
          element.querySelector('caption')?.textContent ||
          '',
        renderHTML: ({ caption }) => ({
          'data-caption': caption || '',
        }),
      },
    }
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
    const { caption, referenceLabel } = node.attrs
    const captionText = String(caption || '').trim()
    const renderedCaption = captionText
      ? `${referenceLabel}: ${captionText}`
      : referenceLabel || ''
    const table = [
      'table',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { style }),
      [
        'caption',
        {
          class: 'umo-node-table-caption',
          contenteditable: 'false',
        },
        renderedCaption,
      ],
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
