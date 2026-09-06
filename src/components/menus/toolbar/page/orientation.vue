<template>
  <menus-button
    ico="page-orientation"
    :text="t('page.orientation.text')"
    menu-type="dropdown"
    overlay-class-name="pdoc-page-orientation-dropdown"
  >
    <template #dropmenu>
      <t-dropdown-menu>
        <!-- A dropdown menu drops any child that is not an item, so the line saying which pages this
             covers has to be one. It is not clickable and says so. -->
        <t-dropdown-item class="pdoc-page-section-note" :divider="true">
          <div class="note" v-text="label"></div>
        </t-dropdown-item>
        <t-dropdown-item
          v-for="(item, index) in orientations"
          :key="index"
          :value="item.value"
          :active="current?.section?.orientation === item.value"
          @click="applyToSection({ orientation: item.value })"
        >
          <div
            class="icon-orientation"
            :class="{ rotate: item.value === 'landscape' }"
          >
            <icon name="page" />
          </div>
          <div class="label">{{ item.label }}</div>
        </t-dropdown-item>
      </t-dropdown-menu>
    </template>
  </menus-button>
</template>

<script setup>
const { current, label, applyToSection } = usePageSection()

const orientations = [
  { label: t('page.orientation.landscape'), value: 'landscape' },
  { label: t('page.orientation.portrait'), value: 'portrait' },
]
</script>

<style lang="less">
.pdoc-page-orientation-dropdown {
  .pdoc-dropdown__item {
    max-width: unset !important;
    &-text {
      display: flex;
      padding: 5px 8px;
      .icon-orientation {
        font-size: 20px;
        margin-right: 5px;
        &.rotate {
          transform: rotate(90deg) rotateY(180deg) translate(0, 3px);
        }
      }
      .label {
        font-size: 14px;
        color: var(--pdoc-text-color);
      }
    }
  }
}
</style>
