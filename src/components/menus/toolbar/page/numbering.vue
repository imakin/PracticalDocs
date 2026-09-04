<template>
  <menus-button
    ico="line-number"
    :text="t('page.pageNumber.text')"
    :menu-active="settings.enabled"
    huge
    menu-type="popup"
    :popup-visible="popupVisible"
    @toggle-popup="togglePopup"
  >
    <template #content>
      <div class="umo-page-number-panel">
        <t-checkbox
          :checked="settings.enabled"
          @change="(value) => update({ enabled: value })"
        >
          {{ t('page.pageNumber.enabled') }}
        </t-checkbox>

        <div class="umo-page-number-field">
          <label>{{ t('page.pageNumber.position') }}</label>
          <t-select
            :value="settings.position"
            size="small"
            :options="positionOptions"
            @change="(value) => update({ position: value })"
          />
        </div>

        <div class="umo-page-number-field">
          <label>{{ t('page.pageNumber.firstPagePosition') }}</label>
          <t-select
            :value="settings.firstPagePosition ?? ''"
            size="small"
            :options="firstPagePositionOptions"
            @change="(value) => update({ firstPagePosition: value || null })"
          />
        </div>

        <div class="umo-page-number-field">
          <label>{{ t('page.pageNumber.format') }}</label>
          <t-select
            :value="settings.format"
            size="small"
            :options="formatOptions"
            @change="(value) => update({ format: value })"
          />
        </div>

        <div class="umo-page-number-field">
          <label>{{ t('page.pageNumber.startAt') }}</label>
          <t-input-number
            :value="settings.startAt"
            size="small"
            theme="column"
            align="center"
            :min="0"
            style="width: 90px"
            @change="(value) => update({ startAt: Number(value) || 0 })"
          />
        </div>

        <div class="umo-page-number-field umo-page-number-field-wide">
          <label>{{ t('page.pageNumber.template') }}</label>
          <t-input
            :value="settings.template"
            size="small"
            :placeholder="'{number}'"
            @change="(value) => update({ template: value })"
          />
        </div>
        <!-- The placeholders are rendered here rather than inside the translated string: i18n reads
             braces as its own interpolation and would swallow them. -->
        <p class="umo-page-number-hint">
          {{ t('page.pageNumber.templateTip') }}
          <code>{{ numberToken }}</code> {{ t('page.pageNumber.tokenNumber') }},
          <code>{{ totalToken }}</code> {{ t('page.pageNumber.tokenTotal') }}
        </p>
        <p class="umo-page-number-hint">{{ t('page.pageNumber.emptyTemplateHint') }}</p>
        <p class="umo-page-number-hint">{{ t('page.pageNumber.styleHint') }}</p>
        <p class="umo-page-number-hint">{{ t('page.pageNumber.sectionHint') }}</p>

        <div class="umo-page-number-divider"></div>
        <strong class="umo-page-number-title">{{ t('page.pageNumber.section.title') }}</strong>

        <p v-if="!section" class="umo-page-number-hint">
          {{ t('page.pageNumber.section.none') }}
        </p>
        <template v-else>
          <t-radio-group
            :value="section.startAt === null ? 'follow' : 'restart'"
            @change="onSectionModeChange"
          >
            <t-radio value="follow">{{ t('page.pageNumber.section.follow') }}</t-radio>
            <t-radio value="restart">{{ t('page.pageNumber.section.restart') }}</t-radio>
          </t-radio-group>
          <t-input-number
            v-if="section.startAt !== null"
            :value="section.startAt"
            size="small"
            theme="column"
            align="center"
            :min="0"
            style="width: 90px; align-self: flex-end"
            @change="(value) => setSection({ sectionStartAt: Number(value) || 0 })"
          />
          <div class="umo-page-number-field">
            <label>{{ t('page.pageNumber.section.format') }}</label>
            <t-select
              :value="section.format ?? ''"
              size="small"
              :options="sectionFormatOptions"
              @change="(value) => setSection({ sectionFormat: value || null })"
            />
          </div>

          <!--
            Position, chapter first page and template, the same three the document above has. The
            engine resolved all of them per section from the start; only the panel offered two, so a
            break could change how a number was counted but not where it sat or what it read.
            An empty option means "keep whatever the section before this one used".
          -->
          <div class="umo-page-number-field">
            <label>{{ t('page.pageNumber.section.position') }}</label>
            <t-select
              :value="section.position ?? ''"
              size="small"
              :options="sectionPositionOptions"
              @change="(value) => setSection({ sectionPosition: value || null })"
            />
          </div>

          <div class="umo-page-number-field">
            <label>{{ t('page.pageNumber.section.firstPagePosition') }}</label>
            <t-select
              :value="section.firstPagePosition ?? ''"
              size="small"
              :options="sectionPositionOptions"
              @change="
                (value) => setSection({ sectionFirstPagePosition: value || null })
              "
            />
          </div>

          <!--
            A template needs three states, not two: follow the section before, or use one of its own -
            which may be empty. An input alone cannot say the difference between "inherit" and
            "show nothing", so the choice is explicit.
          -->
          <t-checkbox
            :checked="section.template !== null"
            @change="onSectionTemplateToggle"
          >
            {{ t('page.pageNumber.section.ownTemplate') }}
          </t-checkbox>
          <div v-if="section.template !== null" class="umo-page-number-field umo-page-number-field-wide">
            <label>{{ t('page.pageNumber.template') }}</label>
            <t-input
              :value="section.template"
              size="small"
              :placeholder="'{number}'"
              @change="(value) => setSection({ sectionTemplate: value ?? '' })"
            />
          </div>
          <p v-if="section.template !== null" class="umo-page-number-hint">
            {{ t('page.pageNumber.emptyTemplateHint') }}
          </p>
        </template>
      </div>
    </template>
  </menus-button>
</template>

<script setup>
import { findPageBreakNear } from '@/extensions/page-break'
import {
  defaultPageNumberSettings,
  PAGE_NUMBER_FORMATS,
  PAGE_NUMBER_POSITIONS,
} from '@/utils/page-numbering'

const page = inject('page')
const editor = inject('editor')

const numberToken = '{number}'
const totalToken = '{total}'

let popupVisible = $ref(false)
const togglePopup = (visible) => {
  popupVisible = visible
}

const settings = $computed(() => ({
  ...defaultPageNumberSettings(),
  ...(page.value.pageNumber || {}),
}))

const positionOptions = $computed(() =>
  PAGE_NUMBER_POSITIONS.map((value) => ({
    value,
    label: t(`page.pageNumber.positions.${value}`),
  })),
)

// The first page of every chapter - the first page, and every page a page break opens.
const firstPagePositionOptions = $computed(() => [
  { value: '', label: t('page.pageNumber.samePosition') },
  ...positionOptions,
])

const formatOptions = $computed(() =>
  PAGE_NUMBER_FORMATS.map((value) => ({
    value,
    label: t(`page.pageNumber.formats.${value}`),
  })),
)

// Replaced rather than mutated, so the page watcher sees a change and the engine redraws.
const update = (patch) => {
  page.value.pageNumber = { ...settings, ...patch }
}

// A break only opens a numbering section if the user asks it to. Reading the attributes of whichever
// break is selected keeps the panel honest about what this particular break does.
const section = $computed(() => {
  const state = editor.value?.state
  if (!state || !popupVisible) {
    return null
  }
  const found = findPageBreakNear(state)
  if (!found) {
    return null
  }
  return {
    startAt: found.node.attrs.sectionStartAt ?? null,
    format: found.node.attrs.sectionFormat ?? null,
    position: found.node.attrs.sectionPosition ?? null,
    firstPagePosition: found.node.attrs.sectionFirstPagePosition ?? null,
    // Kept as null rather than coerced: null means follow the section before, and an empty string
    // means show nothing at all. They are different answers.
    template: found.node.attrs.sectionTemplate ?? null,
  }
})

const sectionPositionOptions = $computed(() => [
  { value: '', label: t('page.pageNumber.section.keepPosition') },
  ...positionOptions,
])

const sectionFormatOptions = $computed(() => [
  { value: '', label: t('page.pageNumber.section.keepFormat') },
  ...formatOptions,
])

const setSection = (attrs) => {
  editor.value?.commands.setPageBreakSection(attrs)
}

// Off puts it back to following the section before; on starts from whatever the document uses, so
// turning it on changes nothing until the writer edits it.
const onSectionTemplateToggle = (checked) => {
  setSection({ sectionTemplate: checked ? settings.template : null })
}

const onSectionModeChange = (value) => {
  // "Follow" is null, not zero: zero is a legitimate start value a user can ask for.
  setSection({ sectionStartAt: value === 'restart' ? 1 : null })
}
</script>

<style lang="less" scoped>
.umo-page-number-panel {
  width: 260px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.umo-page-number-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  label {
    font-size: 12px;
    color: var(--umo-text-color-light);
    white-space: nowrap;
  }
  :deep(.t-select),
  :deep(.t-input) {
    width: 150px;
  }
}
.umo-page-number-field-wide {
  :deep(.t-input) {
    width: 150px;
  }
}
.umo-page-number-divider {
  height: 1px;
  background: var(--umo-border-color);
  margin: 2px 0;
}
.umo-page-number-title {
  font-size: 12px;
}
.umo-page-number-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--umo-text-color-light);
  code {
    font-family: var(--umo-font-family-code, monospace);
    background: var(--umo-fill-color-light, rgba(0, 0, 0, 0.04));
    padding: 0 3px;
    border-radius: 2px;
  }
}
</style>
