<template>
  <modal
    class="pdoc-search-replace-dialog"
    :visible="searchReplace"
    :footer="false"
    :z-index="200"
    width="360px"
    mode="modeless"
    draggable
    @opened="autofocus = true"
    @close="searchReplace = false"
    @closed="autofocus = false"
  >
    <template #header>
      <icon name="search-replace" />
      {{ t('search.title') }}
    </template>
    <div class="pdoc-search-replace-container">
      <div class="pdoc-search-text">
        <t-input
          v-model="searchText"
          :placeholder="t('search.searchText')"
          :autofocus="autofocus"
          clearable
          @enter="next"
        >
          <template #suffix>
            {{
              searchText !== '' && resultLength !== 0
                ? editor?.storage?.searchAndReplace?.resultIndex + 1
                : 0
            }}
            /
            {{ resultLength }}
          </template>
        </t-input>
        <t-button
          :disabled="resultLength === 0"
          shape="square"
          variant="text"
          @click="next"
        >
          <icon name="arrow-down" class="icon-next" />
        </t-button>
        <t-button
          :disabled="resultLength === 0"
          shape="square"
          variant="text"
          @click="previous"
        >
          <icon name="arrow-down" class="icon-prev" />
        </t-button>
      </div>
      <div class="pdoc-replace-text">
        <t-input
          v-model="replaceText"
          :placeholder="t('search.replaceText')"
          clearable
        />
      </div>
      <div class="pdoc-advanced-options">
        <t-checkbox v-model="caseSensitive">
          {{ t('search.caseSensitive') }}
        </t-checkbox>
      </div>
      <div class="pdoc-button-actions">
        <t-button
          :disabled="resultLength === 0"
          theme="default"
          variant="text"
          @click="replace"
          v-text="t('search.replace')"
        >
        </t-button>
        <t-button
          :disabled="resultLength === 0"
          theme="default"
          variant="text"
          @click="replaceAll"
          v-text="t('search.replaceAll')"
        >
        </t-button>
        <t-button
          :disabled="resultLength === 0"
          theme="primary"
          @click="next"
          v-text="t('search.search')"
        ></t-button>
      </div>
    </div>
  </modal>
</template>

<script setup>
import { getSelectionText } from '@/utils/selection'

const editor = inject('editor')
const searchReplace = inject('searchReplace')

let autofocus = $ref(false)
let searchText = $ref('')
let replaceText = $ref('')
const caseSensitive = $ref(false)

const resultLength = computed(
  () => editor.value?.storage.searchAndReplace?.results.length || 0,
)

const clear = () => {
  searchText = ''
  replaceText = ''
  editor.value?.commands.resetIndex()
}

const search = (clearIndex = false) => {
  if (!editor.value) {
    return
  }
  if (clearIndex) {
    editor.value.commands.resetIndex()
  }
  editor.value.commands.setSearchTerm(searchText)
  editor.value.commands.setReplaceTerm(replaceText)
  editor.value.commands.setCaseSensitive(caseSensitive)
}

const goToSelection = () => {
  if (!editor.value) {
    return
  }
  const { results, resultIndex } = editor.value.storage.searchAndReplace
  const position = results[resultIndex]
  if (!position) {
    return
  }
  editor.value.commands.setTextSelection(position)
  const { node } = editor.value.view.domAtPos(
    editor.value.state.selection.anchor,
  )
  node.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

watch(
  () => searchText.trim(),
  (val, oldVal) => {
    if (!val) {
      clear()
    }
    if (val !== oldVal) {
      search(true)
    }
  },
)
watch(
  () => replaceText.trim(),
  (val, oldVal) => (val === oldVal ? null : search()),
)

watch(
  () => caseSensitive,
  (val, oldVal) => {
    if (val !== oldVal) {
      search(true)
    }
  },
)

const next = () => {
  editor.value?.commands.nextSearchResult()
  goToSelection()
}

const previous = () => {
  editor.value?.commands.previousSearchResult()
  goToSelection()
}

const replace = () => {
  editor.value?.commands.replace()
  goToSelection()
}

const replaceAll = () => editor.value?.commands.replaceAll()

watch(
  () => searchReplace.value,
  (visible) => {
    searchText = visible ? getSelectionText(editor.value) : ''
  },
)
</script>

<style lang="less" scoped>
.pdoc-search-text {
  margin-top: 5px;
  display: flex;
  :deep(.pdoc-input__wrap) {
    width: 300px;
    margin-right: 10px;
    .pdoc-input__suffix {
      font-size: 12px;
      opacity: 0.6;
    }
  }
  :deep(.pdoc-button) {
    .pdoc-icon {
      font-size: 20px;
      &.icon-prev {
        transform: rotate(-180deg);
      }
    }
  }
}
.pdoc-replace-text {
  margin-top: 12px;
}
.pdoc-advanced-options {
  margin-top: 12px;
  :deep(.pdoc-checkbox) {
    margin-right: 15px;
  }
}
.pdoc-button-actions {
  margin: 12px 0 -15px;
  text-align: right;
  :deep(.pdoc-button) {
    margin-left: 10px;
  }
}
</style>
<style lang="less">
.pdoc-search-replace-dialog {
  .t-dialog {
    position: absolute !important;
    right: 15px;
    top: 131px !important;
    left: unset;
    bottom: unset;
    user-select: none;
  }
}
.pdoc-editor-container.toolbar-classic {
  .pdoc-search-replace-dialog {
    .t-dialog {
      top: 65px !important;
    }
  }
}

.pdoc-editor-container.pdoc-skin-modern {
  .pdoc-search-replace-dialog {
    .t-dialog {
      top: 146px;
    }
  }
  &.toolbar-classic {
    .pdoc-search-replace-dialog {
      .t-dialog {
        top: 80px;
      }
    }
  }
}
</style>
