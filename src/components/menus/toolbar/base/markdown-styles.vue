<template>
  <menus-button
    ico="markdown"
    :text="t('base.markdown.styles')"
    :tooltip="t('base.markdown.stylesTip')"
    huge
    @menu-click="open = true"
  />

  <modal
    :visible="open"
    :header="t('base.markdown.styles')"
    width="760px"
    :confirm-btn="null"
    :cancel-btn="t('base.markdown.close')"
    @close="open = false"
  >
    <div class="pdoc-markdown-styles">
      <!--
        Both columns are built from the tables in `src/utils/markdown-styles.js`. Adding a section or
        a setting there makes it appear here with nothing to change in this file, which is what the
        user asked for when they asked that more settings be possible later.
      -->
      <div class="pdoc-markdown-styles-sections">
        <button
          v-for="target in targets"
          :key="target.key"
          type="button"
          class="pdoc-markdown-styles-section"
          :class="{ 'is-active': target.key === activeKey, 'is-set': isSet(target.key) }"
          @click="activeKey = target.key"
        >
          {{ target.name }}
          <span v-if="isSet(target.key)" class="pdoc-markdown-styles-dot"></span>
        </button>
      </div>

      <div class="pdoc-markdown-styles-form">
        <t-form label-align="left" label-width="150px">
          <!--
            `v-model` into a local draft, not `:value` bound to the stored setting. A TDesign input
            given a `value` prop is controlled: it renders the prop and nothing else, so with the
            prop only updated on `change` - which fires on blur - every keystroke was overwritten as
            it was typed and the field could not be filled in at all.

            A `t-select` with `filterable creatable` was tried here, to offer suggestions the way the
            block profile fields do. It takes a typed value into the box and then emits no `change`
            for it, so the value was shown and never stored - the same silent discard this dialog was
            just fixed for. The suggestion lists are kept in the field table for when that is worked
            out; the fields stay free text until then.
          -->
          <t-form-item v-for="field in activeFields" :key="field.key" :label="field.label">
            <t-input
              v-model="draft[field.key]"
              :placeholder="field.placeholder"
              clearable
              @blur="commitField(field.key, draft[field.key])"
              @enter="commitField(field.key, draft[field.key])"
            />
          </t-form-item>
          <t-form-item v-if="activeTarget?.nested" :label="nestedField.label">
            <t-input
              v-model="draft[nestedField.key]"
              :placeholder="nestedField.placeholder"
              clearable
              @blur="commitField(nestedField.key, draft[nestedField.key])"
              @enter="commitField(nestedField.key, draft[nestedField.key])"
            />
          </t-form-item>
        </t-form>
        <p class="pdoc-markdown-styles-hint">
          {{ t('base.markdown.stylesHint') }}
        </p>
      </div>
    </div>
  </modal>
</template>

<script setup>
import {
  defaultMarkdownStyles,
  fieldsFor,
  MARKDOWN_STYLE_TARGETS,
  NESTED_INDENT_FIELD,
  withMarkdownStyleDefaults,
} from '@/utils/markdown-styles'

const editor = inject('editor')

let open = $ref(false)
let activeKey = $ref(MARKDOWN_STYLE_TARGETS[0].key)

const targets = MARKDOWN_STYLE_TARGETS
const nestedField = NESTED_INDENT_FIELD

const activeTarget = $computed(() =>
  targets.find((target) => target.key === activeKey),
)
const activeFields = $computed(() => fieldsFor(activeTarget))

/**
 * Read the stored settings, fresh, every time.
 *
 * **Not a `computed`.** Extension storage is a plain object, so replacing `markdownStyles` changes no
 * reactive dependency and a computed over it is never re-evaluated - it keeps returning whatever it
 * saw the first time. That produced two faults the user reported together: reopening the dialog
 * showed every field empty, and saving a second section rebuilt the whole object from that stale
 * first read, **deleting the section edited before it**.
 *
 * The same shape as ADR 0011's second lesson: a computed that reaches into the editor is worth
 * avoiding even when the editor is not writing.
 */
const readStyles = () =>
  withMarkdownStyleDefaults(
    editor.value?.extensionStorage?.documentReferences?.markdownStyles,
  )

// A local copy, so the dialog can redraw when something is saved. The storage is still the truth;
// this is refreshed from it rather than being kept in step by hand.
let stored = $ref(defaultMarkdownStyles())
// The section being edited, held locally so the inputs own their own text while it is being typed.
let draft = $ref({})

const isSet = (key) =>
  Object.values(stored[key] || {}).some(
    (value) => value !== undefined && value !== null && String(value).trim() !== '',
  )

const loadDraft = () => {
  stored = readStyles()
  draft = { ...(stored[activeKey] || {}) }
}

/**
 * Write one field, using the value the event carried.
 *
 * Not by reading `draft` back. The select emits `change` before the parent has re-rendered from
 * `v-model`, so a handler that reads the bound object writes the value it held a moment ago -
 * measured, the field showed `19pt` and nothing was stored.
 *
 * Built from a fresh read of the storage, never from `stored`: anything saved since this dialog was
 * opened, including the section edited a moment ago, has to survive this write.
 */
const commitField = (key, value) => {
  draft = { ...draft, [key]: value ?? '' }
  const next = { ...readStyles(), [activeKey]: { ...draft } }
  editor.value?.commands.setNumberingConfig({ markdownStyles: next })
  stored = next
}

// Reload when the dialog opens and when the writer moves to another section, so the fields always
// show what is stored rather than what was left behind in the section before.
watch(() => [open, activeKey], loadDraft, { immediate: true })
</script>

<style lang="less">
.pdoc-markdown-styles {
  display: flex;
  gap: 16px;
  min-height: 320px;

  .pdoc-markdown-styles-sections {
    flex: 0 0 180px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 380px;
    overflow-y: auto;
    padding-right: 8px;
    border-right: 1px solid var(--pdoc-border-color, #e7e7e7);
  }

  .pdoc-markdown-styles-section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    text-align: left;
    font-size: 13px;
    color: var(--pdoc-text-color, #1f1f1f);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;

    &:hover {
      background-color: var(--pdoc-color-hover, #f5f5f5);
    }

    &.is-active {
      background-color: var(--pdoc-color-hover, #f5f5f5);
      border-color: var(--pdoc-border-color, #e7e7e7);
    }
  }

  // A section that carries a setting says so, so the writer can see what they have changed without
  // opening each one in turn.
  .pdoc-markdown-styles-dot {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--pdoc-primary-color, #2b5aed);
  }

  .pdoc-markdown-styles-form {
    flex: 1 1 auto;
    min-width: 0;
  }

  .pdoc-markdown-styles-hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--pdoc-text-color-light, #8c8c8c);
  }
}
</style>
