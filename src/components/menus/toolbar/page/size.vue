<template>
  <menus-button
    ico="page-size"
    :text="t('page.size.text')"
    menu-type="dropdown"
    overlay-class-name="pdoc-page-size-dropdown"
  >
    <template #dropmenu>
      <t-dropdown-menu>
        <!-- A dropdown menu drops any child that is not an item, so the line saying which pages this
             covers has to be one. It is not clickable and says so. -->
        <t-dropdown-item class="pdoc-page-section-note" :divider="true">
          <div class="note" v-text="label"></div>
        </t-dropdown-item>
        <t-dropdown-item
          v-for="(item, index) in options.dicts?.pageSizes"
          :key="index"
          :value="index"
          :active="current?.section?.size?.width === item.width"
          :divider="
            options.dicts?.pageSizes &&
            options.dicts.pageSizes.length - 1 === index
          "
          :min-column-width="150"
          @click="applyToSection({ size: { ...item } })"
        >
          <div class="label" v-text="l(item.label)"></div>
          <div class="desc">
            {{ item.width + t('page.size.cm') }} ×
            {{ item.height + t('page.size.cm') }}
          </div>
        </t-dropdown-item>
        <t-dropdown-item @click="dialogVisible = true">
          <div class="label" v-text="t('page.size.custom')"></div>
        </t-dropdown-item>
      </t-dropdown-menu>
    </template>
    <page-options :visible="dialogVisible" @close="dialogVisible = false" />
  </menus-button>
</template>

<script setup>
const options = inject('options')
const { current, label, applyToSection } = usePageSection()
const dialogVisible = $ref(false)
</script>

<style lang="less">
.pdoc-page-size-dropdown {
  .pdoc-dropdown__item {
    max-width: unset !important;
    &-text {
      padding: 3px;
      .label {
        font-size: 14px;
        color: var(--pdoc-text-color);
      }
      .desc {
        color: var(--pdoc-text-color-light);
        margin-top: -3px;
        text-transform: uppercase;
        font-size: 12px;
      }
    }
  }
}
</style>
