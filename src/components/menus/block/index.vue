<template>
  <drag-handle
    :editor="editor"
    class="pdoc-block-menu-drag-handle"
    :class="{
      'is-empty': editor?.isEmpty,
      'is-visible': selectedNodePos !== null,
    }"
    :node-type="selectedNode?.type?.name || 'unknown'"
    @node-change="nodeChange"
  >
    <div class="pdoc-block-menu-hander">
      <!--
        Which mode this block is in, shown where its other controls are. Not in the page: a label
        inside the document occupies a line the writer did not write.

        It is also a button, and that is the point: reaching the source by clicking into the block
        means landing a click inside it, which the writer found hard to do. Pressing this asks the
        block for its source and puts the cursor there.
      -->
      <button
        v-if="isMarkdownBlock"
        type="button"
        class="pdoc-block-menu-mode"
        :title="t('blockMenu.openMarkdownSource')"
        @click="openMarkdownSource"
      >
        <icon name="markdown" />
      </button>
      <menus-block-node
        :node="selectedNode"
        :pos="selectedNodePos"
        @dropdown-visible="dropdownVisible"
      />
      <menus-block-common
        v-if="!editor?.isEmpty"
        :node="selectedNode"
        :pos="selectedNodePos"
        @dropdown-visible="dropdownVisible"
      />
    </div>
  </drag-handle>
</template>

<script setup>
import { DragHandle } from '@tiptap/extension-drag-handle-vue-3'

const editor = inject('editor')
let selectedNode = $ref(null)
let selectedNodePos = $ref(null)

const isMarkdownBlock = $computed(
  () => selectedNode?.type?.name === 'markdownBlock',
)

const openMarkdownSource = () => {
  if (selectedNodePos === null) {
    return
  }
  editor.value?.commands.openMarkdownSource({ pos: selectedNodePos })
}

const nodeChange = ({ node, pos }) => {
  selectedNode = node || null
  if (pos !== null) {
    selectedNodePos = pos
  }
}

const dropdownVisible = (visible) => {
  editor.value.commands.setMeta('lockDragHandle', visible)
}
</script>

<style lang="less">
.pdoc-block-menu-mode {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--pdoc-text-color-light, #8c8c8c);
  border-radius: 3px;

  &:hover {
    background-color: var(--pdoc-color-hover, #f5f5f5);
    color: var(--pdoc-text-color, #1f1f1f);
  }
}

.pdoc-block-menu {
  .pdoc-menu-button {
    color: var(--pdoc-text-color-light) !important;
  }
  &-drag-handle {
    z-index: 10;
    outline: solid 1px var(--pdoc-border-color);
    transform: translateX(-15px);
    padding: 2px;
    border-radius: 3px;
    background-color: #fff;
    margin-top: -5px;
    &:hover {
      outline: none;
      box-shadow:
        0 2px 5px rgba(0, 0, 0, 0.06),
        0 0 0 1px rgba(0, 0, 0, 0.1);
    }
    &[node-type='table'],
    &[node-type='horizontalRule'],
    &[node-type='columnContainer'],
    &[node-type='codeBlock'],
    &[node-type='details'],
    &[node-type='ProseMirror-gapcursor'] {
      margin-top: 0;
    }
    &[node-type='pageBreak'] {
      margin-top: -14px;
    }
    &[node-type='footnotes'] {
      display: none;
    }
    &.is-empty {
      z-index: 20;
    }
    &.is-visible {
      visibility: visible !important;
    }
  }
  &-hander {
    display: flex;
    @media print {
      display: none;
    }
    .pdoc-menu-button {
      background-color: #fff;
      width: 20px;
      height: 20px;
      &-wrap {
        margin: 0 !important;
      }
      .pdoc-button-content {
        color: rgba(0, 0, 0, 0.5);
      }
      &:not(.active):hover {
        background-color: var(--pdoc-content-node-selected-background);
        .pdoc-button-content {
          color: var(--pdoc-primary-color);
        }
      }
      &.active {
        &:hover {
          opacity: 0.8;
        }
        .pdoc-button-content {
          color: var(--pdoc-text-color-light);
        }
      }
    }
  }
  &-dropdown {
    .pdoc-block-menu-group-name {
      padding-left: 15px !important;
    }
    .pdoc-dropdown__menu,
    .pdoc-dropdown__submenu {
      --td-radius-default: 0;
      padding: 8px 0 !important;
      .pdoc-divider {
        margin: 4px 0 2px;
        opacity: 0.5;
      }
      .pdoc-dropdown__item {
        padding: 2px 0;
        min-width: 140px !important;
        .pdoc-menu-button {
          background-color: transparent;
          padding: 0 15px;
          box-sizing: border-box;
          justify-content: flex-start;
          width: 100%;
          &-wrap {
            display: block !important;
          }
          .pdoc-button__text {
            width: 100%;
          }
        }
        .pdoc-button-content {
          width: 100%;
          justify-content: flex-start;
          .pdoc-button-text {
            color: var(--pdoc-text-color);
          }
          .pdoc-button-icon {
            margin-right: 3px;
            font-size: 16px;
            color: #666;
          }
          .pdoc-button-kbd {
            flex: 1;
            text-align: right;
            color: var(--pdoc-text-color-light);
            font-family: Arial, Helvetica, sans-serif;
            font-size: 9px;
          }
          .pdoc-heading {
            display: flex;
            color: var(--pdoc-text-color);
            .icon-heading {
              font-size: 12px;
              display: inline-block;
              width: 2em;
            }
          }
        }
        &--disabled {
          .pdoc-button-content {
            opacity: 0.6;
          }
        }
        &-direction {
          opacity: 0.4;
          font-size: 12px !important;
          margin-right: 8px;
        }
        .pdoc-dropdown-item-label {
          padding: 1px 15px;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          -webkit-box-orient: vertical;
        }
      }
    }

    .pdoc-delete-node {
      .pdoc-button {
        * {
          color: var(--pdoc-error-color) !important;
        }
      }
    }
  }
}

.ProseMirror-noderangeselection {
  *::selection {
    background: transparent;
  }
  * {
    caret-color: transparent;
  }
}
</style>
