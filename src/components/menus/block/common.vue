<template>
  <t-dropdown
    placement="bottom-right"
    overlay-class-name="pdoc-block-menu-dropdown"
    trigger="click"
    :destroy-on-close="false"
    :popup-props="popupProps"
  >
    <menus-button
      class="pdoc-block-menu-button"
      :menu-active="menuActive"
      ico="block-menu"
      hide-text
      style="cursor: grab"
    />
    <t-dropdown-menu>
      <t-dropdown-item class="pdoc-block-menu-group-name" disabled>
        {{ t('blockMenu.common') }}
      </t-dropdown-item>
      <t-dropdown-item>
        <menus-button
          ico="node-clear-format"
          :text="t('blockMenu.clearFormat')"
          :tooltip="false"
          @menu-click="clearTextFormatting"
        />
      </t-dropdown-item>
      <t-dropdown-item v-if="canConvertToMarkdown">
        <menus-button
          ico="markdown"
          :text="t('blockMenu.toMarkdown')"
          :tooltip="false"
          @menu-click="convertToMarkdown"
        />
      </t-dropdown-item>
      <t-dropdown-item v-if="isMarkdownBlock">
        <menus-button
          ico="markdown"
          :text="t('blockMenu.fromMarkdown')"
          :tooltip="false"
          @menu-click="convertFromMarkdown"
        />
      </t-dropdown-item>
      <t-dropdown-item divider>
        <menus-button
          ico="node-duplicate"
          :text="t('blockMenu.duplicate')"
          :tooltip="false"
          @menu-click="duplicateNode"
        />
      </t-dropdown-item>
      <t-dropdown-item>
        <menus-button
          ico="node-copy"
          :text="t('blockMenu.copy')"
          :tooltip="false"
          @menu-click="copyNodeToClipboard"
        />
      </t-dropdown-item>
      <t-dropdown-item>
        <menus-button
          ico="node-cut"
          :text="t('blockMenu.cut')"
          :tooltip="false"
          @menu-click="cutNodeToClipboard"
        />
      </t-dropdown-item>
      <t-dropdown-item class="pdoc-delete-node">
        <menus-button
          ico="node-delete-2"
          :text="t('blockMenu.delete')"
          :tooltip="false"
          @menu-click="deleteNode"
        />
      </t-dropdown-item>
    </t-dropdown-menu>
  </t-dropdown>
</template>

<script setup>
const props = defineProps({
  node: {
    type: Object,
    default: null,
  },
  pos: {
    type: Number,
    default: null,
  },
})
const emits = defineEmits(['dropdown-visible'])

const container = inject('container')
const editor = inject('editor')
const blockMenu = inject('blockMenu')

let menuActive = $ref(false)

const popupProps = {
  attach: `${container} .pdoc-main-container`,
  popperOptions: {
    modifiers: [{ name: 'offset', options: { offset: [2, 0] } }],
  },
  onVisibleChange(visible) {
    blockMenu.value = visible
    menuActive = visible
    emits('dropdown-visible', visible)
  },
}

// The route into markdown mode, and the route back out. Without these the block can only be created
// empty from the Insert menu, so a paragraph already written could never become one.
const isMarkdownBlock = $computed(() => props.node?.type?.name === 'markdownBlock')
const canConvertToMarkdown = $computed(() => {
  const { node } = props
  // An atom or a leaf carries no text to become markdown; converting one would delete it.
  return !!node && !isMarkdownBlock && !node.isAtom && !node.isLeaf
})

const convertToMarkdown = () => {
  editor.value?.commands.convertToMarkdownBlock({ pos: props.pos })
}
const convertFromMarkdown = () => {
  editor.value?.commands.unwrapMarkdownBlock({ pos: props.pos })
}

const clearTextFormatting = () => {
  editor.value
    ?.chain()
    .setNodeSelection(props.pos)
    .focus()
    .unsetAllMarks()
    .run()
}
const copyNodeToClipboard = () => {
  editor.value?.commands.setNodeSelection(props.pos)
  document.execCommand('copy')
}
const cutNodeToClipboard = () => {
  editor.value?.commands.setNodeSelection(props.pos)
  document.execCommand('cut')
}
const duplicateNode = () => {
  editor.value?.commands.insertContentAt(props.pos, props.node?.toJSON())
}
const deleteNode = () => {
  editor.value
    ?.chain()
    .setNodeSelection(props.pos)
    .focus()
    .deleteSelection()
    .run()
}
</script>
