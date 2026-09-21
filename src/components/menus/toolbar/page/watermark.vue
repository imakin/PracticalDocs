<template>
  <menus-button
    ico="watermark"
    :text="t('page.watermark.text')"
    huge
    menu-type="popup"
    :popup-visible="popupVisible"
    @toggle-popup="togglePopup"
  >
    <template #content>
      <div class="pdoc-watermark-container">
        <div class="pdoc-watermark-toolbar">
          <menus-button
            style="width: 140px"
            :tooltip="t('page.watermark.fontFamily')"
            menu-type="select"
            :select-options="fonts"
            :select-value="page.watermark?.fontFamily"
            @menu-click="
              (value) => {
                updateWatermark({ fontFamily: value })
              }
            "
          ></menus-button>
          <menus-button
            menu-type="input"
            :tooltip="t('page.watermark.fontSize')"
          >
            <t-input-number
              v-if="page.watermark"
              :value="page.watermark.fontSize"
              style="width: 60px"
              size="small"
              theme="column"
              align="center"
              :max="96"
              :min="12"
              :allow-input-over-limit="false"
              placeholder=""
              @change="
                (newFontSize) => updateWatermark({ fontSize: newFontSize })
              "
            >
            </t-input-number>
          </menus-button>
          <menus-toolbar-base-color
            v-if="page.watermark"
            :text="t('page.watermark.fontColor')"
            :default-color="page.watermark?.fontColor"
            modeless
            @change="
              (value) => {
                updateWatermark({ fontColor: value })
              }
            "
          />
          <menus-toolbar-base-bold
            v-if="page.watermark"
            :menu-active="page.watermark.fontWeight === 'bold'"
            @menu-click-through="
              updateWatermark({
                fontWeight:
                  page.watermark.fontWeight === 'bold' ? 'normal' : 'bold',
              })
            "
          />
        </div>
        <t-input
          v-if="page.watermark"
          :value="page.watermark.text"
          maxlength="30"
          clearable
          :placeholder="t('page.watermark.content')"
          @change="(newText) => updateWatermark({ text: newText })"
        />
        <div
          class="pdoc-watermark-type-title"
          v-text="t('page.watermark.type')"
        ></div>
        <div class="pdoc-watermark-type">
          <div
            v-if="page.watermark"
            class="item compact"
            :class="{ active: page.watermark.type === 'compact' }"
            @click="updateWatermark({ type: 'compact' })"
          >
            <div class="bg"></div>
            <span v-text="t('page.watermark.compact')"></span>
          </div>
          <div
            v-if="page.watermark"
            class="item spacious"
            :class="{ active: page.watermark.type === 'spacious' }"
            @click="updateWatermark({ type: 'spacious' })"
          >
            <div class="bg"></div>
            <span v-text="t('page.watermark.spacious')"></span>
          </div>
        </div>
        <t-button
          v-if="page.watermark?.text"
          class="pdoc-clear-button"
          block
          variant="outline"
          @click="clearWatermark"
          v-text="t('page.watermark.clear')"
        ></t-button>
      </div>
    </template>
  </menus-button>
</template>

<script setup>
const { popupVisible, togglePopup } = usePopup()

const page = inject('page')
const options = inject('options')

const fonts = options.value.dicts?.fonts.map((item) => {
  return {
    label: l(item.label),
    value: item.value || '',
  }
})
// 公共方法：更新水印属性（生成新对象，改变引用）
const updateWatermark = (props) => {
  if (!page.value.watermark) return
  // 生成新对象，确保引用改变
  page.value.watermark = { ...page.value.watermark, ...props }
}
const clearWatermark = () => {
  updateWatermark({ text: '' })
  popupVisible.value = false
}
</script>

<style lang="less" scoped>
.pdoc-watermark-container {
  width: 320px;
  .pdoc-watermark-toolbar {
    display: flex;
    align-items: center;
    margin-bottom: 10px;
  }
  .pdoc-watermark-type {
    display: flex;
    &-title {
      color: var(--pdoc-text-color-light);
      margin: 10px 0;
      font-size: 12px;
    }
    .item {
      cursor: pointer;
      &:first-child {
        margin-right: 10px;
      }
      .bg {
        width: 70px;
        height: 90px;
        border: solid 1px var(--pdoc-border-color);
        position: relative;
        border-radius: var(--pdoc-radius);
        background-size: cover;
        background-position: center center;
        background-repeat: no-repeat;
      }
      span {
        display: block;
        background-color: rgba(0, 0, 0, 0.05);
        border-radius: 12px;
        padding: 0 10px;
        text-align: center;
        margin-top: 8px;
        font-size: 12px;
      }
      &:hover,
      &.active {
        .bg {
          border-color: var(--pdoc-primary-color);
        }
        span {
          color: var(--pdoc-primary-color);
        }
      }
      // Drawn rather than photographed. These two only show the reader how far apart the repeats
      // sit, and the pictures that used to do it were screenshots of a Chinese phrase baked into a
      // PNG - untranslatable, and three and a half kilobytes each for a 70 by 90 swatch.
      &.compact .bg {
        background-image: url('@/assets/images/watermark-compact.svg');
      }
      &.spacious .bg {
        background-image: url('@/assets/images/watermark-spacious.svg');
      }
    }
  }
  .pdoc-clear-button {
    margin-top: 20px;
  }
}
</style>
