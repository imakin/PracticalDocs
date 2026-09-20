<template>
  <node-view-wrapper class="pdoc-node-view">
    <!--
      No panel, no label, no buttons. The product's first principle is that nothing occupies a line
      of the page that the user did not write, and the bar this block used to carry - Markdown,
      Rendered, Source - was exactly that. Which mode a block is in is shown on its handle, beside
      the controls every other block already has.

      A markdown block therefore looks like an ordinary block, because that is what it is.
    -->
    <div class="pdoc-node-markdown-block" :class="{ 'is-editing': active }">
      <textarea
        v-show="active"
        ref="sourceRef"
        v-model="draft"
        class="pdoc-markdown-source"
        spellcheck="false"
        @input="autoSize"
        @focus="enter"
        @blur="leave"
        @keydown.stop="onKeydown"
      ></textarea>

      <!--
        v-show, never v-if. ProseMirror holds this element as the node's contentDOM, and removing it
        detaches the content the editor is managing.

        contenteditable false is rule 2 of ADR 0012: the rendered half is a view of the source.
        Clicking it selects the block, which is what opens the source.
      -->
      <node-view-content
        v-show="!active"
        class="pdoc-markdown-rendered"
        contenteditable="false"
        @mousedown="select"
      />
    </div>
  </node-view-wrapper>
</template>

<script setup>
import { NodeViewContent, nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'

const props = defineProps(nodeViewProps)

// The source shows while the block holds the cursor and hides when the cursor leaves. There is no
// control for it, because the writer has already said which block they are in by being in it.
//
// `selected` alone is not enough: focusing the textarea takes focus out of ProseMirror, which clears
// the node selection, so the source would close on the first keystroke. `typing` holds it open.
let typing = $ref(false)
let draft = $ref(props.node.attrs.source ?? '')
let sourceRef = $ref(null)

// Held open by the button on the block's handle, as a route that does not depend on landing a click
// inside the block. It lapses on its own after a few seconds, so a block cannot be left showing its
// source because a button was pressed by accident.
//
// The timer is a safety net rather than the mechanism: pressing the button also puts the cursor in
// the source, and the moment that succeeds the timer is cancelled and the ordinary rule takes over -
// the source closes when the cursor leaves.
const HOLD_MS = 5000
let held = $ref(false)
let holdTimer = null

const clearHold = () => {
  if (holdTimer) {
    clearTimeout(holdTimer)
    holdTimer = null
  }
}

const active = $computed(() => props.selected || typing || held)

const autoSize = () => {
  const element = sourceRef
  if (!element) {
    return
  }
  // Grow with the text. A scrollbar inside a block would be a second way to move through a document
  // that already scrolls, and it would hide the writer's own words.
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}

const commit = () => {
  const pos = props.getPos?.()
  if (typeof pos !== 'number' || draft === props.node.attrs.source) {
    return
  }
  props.editor?.commands.setMarkdownSource({ pos, source: draft })
}

const enter = () => {
  typing = true
  // The writer is in this source. A toolbar action taken from here belongs to this block, even
  // though pressing a toolbar button takes the focus back out of the textarea.
  const store = props.editor?.storage?.markdownBlock
  if (store) {
    store.openPos = props.getPos?.() ?? null
  }
  // The cursor is in. The hold was only ever a way of getting here, so it stops counting down.
  held = false
  clearHold()
}

const leave = () => {
  typing = false
  // Leaving is leaving, however the source was opened. A hold that outlived the cursor would keep a
  // block open after the writer had already moved on.
  held = false
  clearHold()
  commit()
}

/**
 * Text arriving from somewhere other than the keyboard - today, a cross-reference chosen in the
 * toolbar dialog.
 *
 * It lands at the caret, which is why this has to happen here: the caret inside a textarea is not
 * part of the document, so no command can know where the writer was. `selectionStart` survives the
 * blur that pressing a toolbar button causes, so the position is still the one they left.
 *
 * A block whose source is closed takes the text at the end of its markdown and opens, rather than
 * refusing. Refusing would mean the writer has to remember to put the cursor back first.
 */
const onSourceInsert = ({ pos, text }) => {
  if (pos !== props.getPos?.()) {
    return
  }
  const element = sourceRef
  const base = active ? draft : (props.node.attrs.source ?? '')
  const start =
    element && active ? (element.selectionStart ?? base.length) : base.length
  const end = element && active ? (element.selectionEnd ?? start) : base.length
  draft = base.slice(0, start) + text + base.slice(end)
  commit()
  held = true
  clearHold()
  holdTimer = setTimeout(() => {
    held = false
    holdTimer = null
  }, HOLD_MS)
  nextTick(() => {
    autoSize()
    if (sourceRef) {
      // After what was inserted, so the writer carries on typing where they left off.
      const caret = start + text.length
      sourceRef.setSelectionRange(caret, caret)
    }
  })
  focusSource()
}

const onKeydown = (event) => {
  // Escape leaves the source, the same way it leaves any other editing surface here.
  if (event.key === 'Escape') {
    sourceRef?.blur()
  }
}

const select = (event) => {
  const pos = props.getPos?.()
  if (typeof pos !== 'number') {
    return
  }
  // Take the event. Left to itself the editor resolves its own selection from the click, which lands
  // somewhere other than this node and clears the node selection the moment we set it - so the
  // source would open and close again on a single press.
  event?.preventDefault?.()
  props.editor?.commands.setNodeSelection(pos)
}

// Focus twice, deliberately. Setting a node selection makes ProseMirror focus its own DOM, and that
// can land after ours - which showed the source without the cursor being in it, so the block looked
// open and would not accept a keystroke. The second attempt runs after the editor has settled.
const focusSource = () => {
  nextTick(() => {
    sourceRef?.focus()
    autoSize()
  })
  setTimeout(() => {
    if (active && sourceRef && document.activeElement !== sourceRef) {
      sourceRef.focus()
    }
  }, 60)
}

watch(
  () => active,
  (isActive) => {
    if (!isActive) {
      return
    }
    draft = props.node.attrs.source ?? ''
    focusSource()
  },
  { immediate: true },
)

// The button on the block's handle asks for this block by position.
const onSourceRequested = (pos) => {
  if (pos !== props.getPos?.()) {
    return
  }
  draft = props.node.attrs.source ?? ''
  held = true
  clearHold()
  holdTimer = setTimeout(() => {
    held = false
    holdTimer = null
  }, HOLD_MS)
  focusSource()
}

onMounted(() => {
  props.editor?.on?.('markdownSourceRequested', onSourceRequested)
  props.editor?.on?.('markdownSourceInsert', onSourceInsert)
})
onBeforeUnmount(() => {
  props.editor?.off?.('markdownSourceRequested', onSourceRequested)
  props.editor?.off?.('markdownSourceInsert', onSourceInsert)
  clearHold()
})

// The source can change underneath an open editor - a rebuild on load, or an undo.
watch(
  () => props.node.attrs.source,
  (value) => {
    if (typing) {
      return
    }
    draft = value ?? ''
  },
)
</script>

<style lang="less">
.pdoc-node-markdown-block {
  // Nothing in the resting state. A markdown block that is not being edited has to be
  // indistinguishable from the blocks around it, or it is chrome.
  position: relative;
  // `.pdoc-node-view` is a flex container, so a child with no width shrinks to fit its content - and
  // a textarea's content width is its `cols` attribute, which defaults to 20 characters. The source
  // came out one narrow column, and because the rendered half was full width, a click landed inside
  // the block, opened the source, then landed outside the narrow textarea and closed it again, over
  // and over. `width: 100%` on a flex item with no definite parent width is not enough on its own;
  // the flex sizing is what has to be pinned. The document map's node view solves it the same way.
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;

  .pdoc-markdown-source {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 0;
    margin: 0;
    border: none;
    outline: none;
    overflow: hidden;
    resize: none;
    // Monospace is the only signal that this is source rather than prose, and it is a property of
    // the text itself rather than a box drawn around it.
    font-family: var(--pdoc-font-family-code, monospace);
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    background-color: transparent;
    color: var(--pdoc-text-color, #1f1f1f);
  }
}
</style>
