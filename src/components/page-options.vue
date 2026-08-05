<template>
  <modal
    :visible="visible"
    width="450px"
    :confirm-btn="t('base.confirm')"
    :cancel-btn="t('base.cancel')"
    @close="emits('close')"
    @confirm="onConfirm"
  >
    <template #header>
      <icon name="page-margin" />
      {{ t('pageOptions.title') }}
    </template>
    <div class="umo-page-options-container">
      <t-form label-align="left">
        <t-form-item
          v-if="page.layout === 'page'"
          :label="t('page.orientation.text')"
        >
          <t-radio-group
            v-model="pageOptions.orientation"
            variant="default-filled"
          >
            <t-radio-button value="landscape">
              <icon class="icon-rotate" name="page" />
              {{ t('page.orientation.landscape') }}
            </t-radio-button>
            <t-radio-button value="portrait">
              <icon name="page" />
              {{ t('page.orientation.portrait') }}
            </t-radio-button>
          </t-radio-group>
        </t-form-item>
        <t-form-item v-if="page.layout === 'page'" :label="t('page.size.text')">
          <t-select
            :value="selectedPageSizeIndex >= 0 ? selectedPageSizeIndex : undefined"
            :popup-props="{
              overlayClassName: 'umo-page-size-select',
              destroyOnClose: true,
              attach: container,
            }"
            @change="selectPageSize"
          >
            <template #valueDisplay>
              {{ l(pageOptions.size?.label) }}
            </template>
            <t-option
              v-for="(item, index) in options.dicts?.pageSizes"
              :key="index"
              :value="index"
              :title="`${l(item.label)} (${item.width}×${item.height}${t('page.size.cm')})`"
            >
              <div class="label" v-text="l(item.label)"></div>
              <div class="desc">
                {{ item.width }}{{ t('page.size.cm') }} × {{ item.height
                }}{{ t('page.size.cm') }}
              </div>
            </t-option>
          </t-select>
        </t-form-item>
        <t-form-item
          v-if="page.layout === 'page'"
          :label="t('pageOptions.size.text')"
        >
          <div class="umo-page-setting">
            <div class="item">
              <t-input-number
                v-if="pageOptions?.size"
                v-model="pageOptions.size.width"
                class="umo-page-setting-number"
                theme="normal"
                align="center"
                :min="10"
                :label="t('pageOptions.size.width')"
                :suffix="t('page.size.cm')"
                placeholder=""
                :allow-input-over-limit="false"
                @blur="(val) => inputPageSize(Number(val), 'width')"
              />
            </div>
            <div class="item">
              <t-input-number
                v-if="pageOptions?.size"
                v-model="pageOptions.size.height"
                class="umo-page-setting-number"
                theme="normal"
                align="center"
                :min="10"
                :label="t('pageOptions.size.height')"
                :suffix="t('page.size.cm')"
                placeholder=""
                :allow-input-over-limit="false"
                @blur="(val) => inputPageSize(Number(val), 'height')"
              />
            </div>
          </div>
        </t-form-item>
        <t-form-item :label="t('pageOptions.margin.text')" name="name">
          <div>
            <div class="umo-page-margin-inbuilt">
              <div
                class="item"
                :class="{ active: !pageOptions.margin?.layout }"
                @click="selectPageMargin(options.page?.defaultMargin)"
                v-text="t('pageOptions.margin.default')"
              ></div>
              <div
                class="item narrow"
                :class="{ active: pageOptions.margin?.layout === 'narrow' }"
                @click="
                  selectPageMargin({
                    left: 1.27,
                    right: 1.27,
                    top: 1.27,
                    bottom: 1.27,
                    layout: 'narrow',
                  })
                "
                v-text="t('pageOptions.margin.narrow')"
              ></div>
              <div
                class="item moderate"
                :class="{ active: pageOptions.margin?.layout === 'moderate' }"
                @click="
                  selectPageMargin({
                    left: 1.91,
                    right: 1.91,
                    top: 2.54,
                    bottom: 2.54,
                    layout: 'moderate',
                  })
                "
                v-text="t('pageOptions.margin.moderate')"
              ></div>
              <div
                class="item wide"
                :class="{ active: pageOptions.margin?.layout === 'wide' }"
                @click="
                  selectPageMargin({
                    top: 2.54,
                    bottom: 2.54,
                    left: 5.08,
                    right: 5.08,
                    layout: 'wide',
                  })
                "
                v-text="t('pageOptions.margin.wide')"
              ></div>
            </div>
            <div class="umo-page-setting">
              <div class="item">
                <t-input-number
                  v-if="pageOptions?.margin"
                  v-model="pageOptions.margin.top"
                  class="umo-page-setting-number"
                  theme="normal"
                  align="center"
                  :min="0"
                  :step="0.1"
                  :label="t('pageOptions.margin.top')"
                  :suffix="t('page.size.cm')"
                  placeholder=""
                  :allow-input-over-limit="false"
                  @change="(val) => inputPageMargin(Number(val), 'top')"
                  @blur="(val) => inputPageMargin(Number(val), 'top')"
                />
              </div>
              <div class="item">
                <t-input-number
                  v-if="pageOptions?.margin"
                  v-model="pageOptions.margin.bottom"
                  class="umo-page-setting-number"
                  theme="normal"
                  align="center"
                  :min="0"
                  :step="0.1"
                  :label="t('pageOptions.margin.bottom')"
                  :suffix="t('page.size.cm')"
                  placeholder=""
                  :allow-input-over-limit="false"
                  @change="(val) => inputPageMargin(Number(val), 'bottom')"
                  @blur="(val) => inputPageMargin(Number(val), 'bottom')"
                />
              </div>
              <div class="item">
                <t-input-number
                  v-if="pageOptions?.margin"
                  v-model="pageOptions.margin.left"
                  class="umo-page-setting-number"
                  theme="normal"
                  align="center"
                  :min="0"
                  :step="0.1"
                  :label="t('pageOptions.margin.left')"
                  :suffix="t('page.size.cm')"
                  placeholder=""
                  :allow-input-over-limit="false"
                  @change="(val) => inputPageMargin(Number(val), 'left')"
                  @blur="(val) => inputPageMargin(Number(val), 'left')"
                />
              </div>
              <div class="item">
                <t-input-number
                  v-if="pageOptions?.margin"
                  v-model="pageOptions.margin.right"
                  class="umo-page-setting-number"
                  theme="normal"
                  align="center"
                  :min="0"
                  :step="0.1"
                  :label="t('pageOptions.margin.right')"
                  :suffix="t('page.size.cm')"
                  placeholder=""
                  :allow-input-over-limit="false"
                  @change="(val) => inputPageMargin(Number(val), 'right')"
                  @blur="(val) => inputPageMargin(Number(val), 'right')"
                />
              </div>
            </div>
          </div>
        </t-form-item>
      </t-form>
    </div>
  </modal>
</template>

<script setup>
const props = defineProps({
  visible: {
    type: Boolean,
    required: true,
  },
})
const emits = defineEmits(['close'])

const container = inject('container')
const page = inject('page')
const options = inject('options')

let pageOptions = $ref({})
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      pageOptions = JSON.parse(JSON.stringify(page.value))
    }
  },
  { immediate: true },
)

const selectedPageSizeIndex = computed(() => {
  if (!pageOptions.size || !options.value?.dicts?.pageSizes) return -1
  return options.value.dicts.pageSizes.findIndex(
    (item) => Number(item.width) === Number(pageOptions.size?.width) && Number(item.height) === Number(pageOptions.size?.height)
  )
})

// Page size select dropdown handler
const selectPageSize = (value) => {
  const selected = options.value?.dicts?.pageSizes[value]
  if (selected) {
    pageOptions.size = { ...selected }
  }
}

// Manual width/height input blur handler
const inputPageSize = (value, field) => {
  if (!pageOptions.size) {
    pageOptions.size = { width: 21, height: 29.7, label: '' }
  }
  const val = Number(value) || 10
  const nextSize = {
    ...pageOptions.size,
    [field]: Math.max(10, val),
  }
  const dicts = options.value?.dicts?.pageSizes || []
  const matchedPreset = dicts.find(
    (p) => Number(p.width) === Number(nextSize.width) && Number(p.height) === Number(nextSize.height)
  )
  if (matchedPreset) {
    pageOptions.size = { ...matchedPreset }
  } else {
    nextSize.label = t('pageOptions.size.custom')
    pageOptions.size = nextSize
  }
}

// Preset page margin handler
const selectPageMargin = (margin) => {
  pageOptions.margin = { ...margin }
}

// Manual top/bottom/left/right page margin input handler
const inputPageMargin = (value, field) => {
  if (!pageOptions.margin) {
    pageOptions.margin = { top: 2.54, bottom: 2.54, left: 3.18, right: 3.18 }
  }
  const val = Number(value) >= 0 ? Number(value) : 0
  const nextMargin = {
    ...pageOptions.margin,
    [field]: val,
    layout: 'custom',
  }
  pageOptions.margin = nextMargin
}

const onConfirm = () => {
  page.value = pageOptions
  emits('close')
}
</script>

<style lang="less" scoped>
.umo-page-options-container {
  width: 400px;
  margin-top: 15px;
  :deep(.umo-radio-button__label) {
    display: flex;
    align-items: center;
    .umo-icon {
      margin-right: 5px;
      font-size: 20px;
      &.icon-rotate {
        transform: rotate(90deg) rotateY(180deg);
      }
    }
  }
}

.umo-page-margin-inbuilt {
  display: flex;
  justify-content: space-between;
  margin-bottom: 20px;
  .item {
    width: 60px;
    height: 80px;
    border: solid 1px var(--umo-border-color);
    border-radius: var(--umo-radius);
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--umo-button-hover-background);
    position: relative;
    cursor: pointer;
    overflow: hidden;
    font-size: 8px;
    &::after {
      position: absolute;
      display: block;
      content: ' ';
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
      border: solid 8px var(--umo-color-white);
      border-left-width: 10px;
      border-right-width: 10px;
    }
    &.narrow::after {
      border-width: 5px;
    }
    &.moderate::after {
      border-left-width: 6px;
      border-right-width: 6px;
    }
    &.wide::after {
      border-left-width: 13px;
      border-right-width: 13px;
    }
    &:hover,
    &.active {
      border-color: var(--umo-primary-color);
    }
  }
}
.umo-page-setting {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  width: 100%;
  .item {
    display: flex;
    justify-content: space-between;
    &:nth-child(2n + 1) {
      margin-right: 10px;
    }
    &:first-child {
      margin-bottom: 10px;
    }
  }
  &-number {
    width: 140px;
    :deep(.umo-input__suffix) {
      opacity: 0.4;
    }
  }
}
</style>

<style lang="less">
.umo-page-size-select {
  .umo-select-option {
    padding: 0 8px;
    > span {
      display: flex;
      justify-content: space-between;
      width: 100%;
    }
    .desc {
      font-size: 12px;
      color: var(--umo-text-color-light);
    }
  }
}
</style>
