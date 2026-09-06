<template>
  <menus-button
    ico="share"
    :text="t('export.share.text')"
    huge
    @menu-click="dialogVisible = true"
  />
  <modal
    :visible="dialogVisible"
    width="420px"
    :confirm-btn="t('export.share.copy')"
    @confirm="copyLink"
    @close="dialogVisible = false"
  >
    <template #header>
      <icon name="share" />
      {{ t('export.share.text') }}
    </template>
    <div class="pdoc-share-container">
      <div class="pdoc-share-tip" v-text="t('export.share.tip')"></div>
      <t-textarea
        class="pdoc-share-textarea"
        :value="options.shareUrl"
        readonly
        autosize
      ></t-textarea>
    </div>
  </modal>
</template>

<script setup>
const options = inject('options')
const container = inject('container')
let dialogVisible = $ref(false)

const copyLink = () => {
  useCopy(options.value.shareUrl, t('export.share.copied'), container)
  dialogVisible = false
}
</script>

<style lang="less" scoped>
.pdoc-share-container {
  padding: 2px;
  .pdoc-share-tip {
    font-size: 12px;
    color: var(--pdoc-text-color-light);
    margin-bottom: 6px;
    line-height: 1.4;
  }
  .pdoc-share-textarea {
    :deep(textarea) {
      word-break: break-all;
      word-wrap: break-word;
    }
  }
}
</style>
