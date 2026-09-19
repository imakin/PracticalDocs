<template>
  <menus-button
    ico="table-cells-background"
    :text="t('table.cellBorders.text')"
    :tooltip="t('table.cellBorders.tip')"
    menu-type="dropdown"
    huge
    :select-options="choices"
    :disabled="!editor?.can().setCellAttribute('borderTop', '')"
    @click="apply"
  />
</template>

<script setup>
const editor = inject('editor')

/**
 * The line a cell draws when a side is turned on.
 *
 * The stylesheet's own value, so a side switched off and on again matches the rest of the table
 * rather than becoming a second, slightly different line. It is a custom property, which the export
 * resolves too: print takes every stylesheet on the page with it.
 */
const RULE = '1px solid var(--pdoc-content-table-border-color)'
const NONE = 'none'
const SIDES = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft']

const choices = [
  { content: t('table.cellBorders.all'), value: 'all' },
  { content: t('table.cellBorders.none'), value: 'none' },
  { content: t('table.cellBorders.horizontal'), value: 'horizontal', divider: true },
  { content: t('table.cellBorders.top'), value: 'borderTop' },
  { content: t('table.cellBorders.right'), value: 'borderRight' },
  { content: t('table.cellBorders.bottom'), value: 'borderBottom' },
  { content: t('table.cellBorders.left'), value: 'borderLeft' },
]

const setSides = (values) => {
  let chain = editor.value?.chain().focus()
  if (!chain) {
    return
  }
  for (const [side, value] of Object.entries(values)) {
    chain = chain.setCellAttribute(side, value)
  }
  chain.run()
}

const apply = ({ value }) => {
  if (!value) {
    return
  }
  if (value === 'all' || value === 'none') {
    const line = value === 'all' ? RULE : NONE
    setSides(Object.fromEntries(SIDES.map((side) => [side, line])))
    return
  }
  if (value === 'horizontal') {
    // The rule a thesis usually asks for: a line above and below, nothing down the sides.
    setSides({
      borderTop: RULE,
      borderBottom: RULE,
      borderLeft: NONE,
      borderRight: NONE,
    })
    return
  }
  // One side, toggled. What the cell the cursor is in carries decides which way it goes, so a second
  // press of the same entry puts it back - which is what a person expects of a named side.
  const current = editor.value?.getAttributes('tableCell')?.[value]
  const alsoHeader = editor.value?.getAttributes('tableHeader')?.[value]
  const showing = (current ?? alsoHeader ?? null) !== NONE
  setSides({ [value]: showing ? NONE : RULE })
}
</script>
