<template>
  <menus-button
    v-if="options.document?.enableMarkdown"
    :text="t('base.markdown.render')"
    :tooltip="t('base.markdown.renderTip')"
    ico="markdown"
    menu-type="dropdown"
    huge
    :select-options="renderOptions"
    @click="handleRender"
  />
</template>

<script setup>
import { renderMarkdown } from '@/utils/markdown'

const container = inject('container')
const editor = inject('editor')
const options = inject('options')

const renderOptions = [
  {
    content: t('base.markdown.renderCurrentBlock'),
    value: 'current-block',
  },
  {
    content: t('base.markdown.renderEntireDocument'),
    value: 'entire-document',
  },
]

const showMessage = (type, content) => {
  useMessage(type, {
    attach: container,
    content,
  })
}

const getActiveTextBlock = () => {
  if (!editor.value) {
    return null
  }

  const { selection } = editor.value.state
  if (selection.node?.isTextblock) {
    return {
      from: selection.from,
      to: selection.to,
      node: selection.node,
    }
  }

  const { $from } = selection
  let { depth } = $from
  for (; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.isTextblock) {
      return {
        from: $from.before(depth),
        to: $from.after(depth),
        node,
      }
    }
  }

  return null
}

const runRender = (source, applyContent) => {
  if (!source.trim()) {
    showMessage('warning', t('base.markdown.renderEmpty'))
    return
  }

  try {
    applyContent(renderMarkdown(source))
    showMessage('success', t('base.markdown.renderSuccess'))
  } catch (error) {
    console.warn('Unable to render Markdown content.', error)
    showMessage('error', t('base.markdown.renderError'))
  }
}

const renderCurrentBlock = () => {
  const block = getActiveTextBlock()
  if (!block || !editor.value) {
    showMessage('warning', t('base.markdown.renderNoActiveBlock'))
    return
  }

  const source = block.node.textBetween(0, block.node.content.size, '\n', '\n')
  runRender(source, (html) => {
    editor.value
      .chain()
      .focus()
      .insertContentAt({ from: block.from, to: block.to }, html)
      .run()
  })
}

const renderEntireDocument = () => {
  if (!editor.value) {
    return
  }

  const source = editor.value.getText()
  runRender(source, (html) => {
    editor.value.chain().focus().setContent(html).run()
  })
}

const confirmRenderEntireDocument = () => {
  const dialog = useConfirm({
    attach: container,
    theme: 'warning',
    header: t('base.markdown.renderAllTitle'),
    body: t('base.markdown.renderAllMessage'),
    confirmBtn: {
      theme: 'warning',
      content: t('base.markdown.renderConfirm'),
    },
    onConfirm() {
      dialog.destroy()
      renderEntireDocument()
    },
  })
}

const handleRender = ({ value }) => {
  if (value === 'current-block') {
    renderCurrentBlock()
  }
  if (value === 'entire-document') {
    confirmRenderEntireDocument()
  }
}
</script>
