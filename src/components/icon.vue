<template>
  <svg class="pdoc-icon" aria-hidden="true" :width="size" :height="size">
    <use :xlink:href="`#pdoc-icon-${props.name}`" :fill="color" />
  </svg>
</template>

<script setup>
const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  size: {
    type: String,
    default: '1em',
  },
  color: {
    type: String,
    default: 'currentcolor',
  },
})
</script>

<style lang="less">
.pdoc-icon {
  display: flex;
}
</style>
