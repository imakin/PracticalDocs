<template>
  <!--
    What the licence asks for, and nothing else.
    
    MIT has one condition: the copyright notice and the permission notice travel with every copy of
    the software. It says nothing about a logo, a contributor list or a link to anyone's site, so the
    upstream project's are gone. What is left is the notice itself, the version, and a way to read
    the full licence text - which ships beside this page as `LICENSE`.
  -->
  <modal
    :visible="visible"
    width="320px"
    :footer="false"
    @close="emits('close')"
  >
    <template #header>
      <icon name="copyright" />
      {{ t('about.title') }}
    </template>
    <div class="pdoc-about">
      <img src="@/assets/images/logo.svg" width="96" alt="" />
      <p class="pdoc-about-name">PracticalDocs</p>
      <p>{{ t('about.version') }}: v{{ version }}</p>
      <t-divider></t-divider>
      <p class="pdoc-about-notice">{{ OWN_NOTICE }}</p>
      <p class="pdoc-about-notice">{{ t('about.basedOn') }}</p>
      <p class="pdoc-about-notice">{{ UPSTREAM_NOTICE }}</p>
      <p>
        <a :href="LICENSE_URL" target="_blank" rel="noreferrer">
          {{ t('about.licence') }}
        </a>
      </p>
    </div>
  </modal>
</template>

<script setup>
import { authorName, version } from '@/utils/copyright'

defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
})
const emits = defineEmits(['close'])

// This editor's own work, and then the work it was built on. MIT lets a derivative carry its own
// copyright; what it does not let anyone do is drop the original one, which is why both are here and
// why the upstream notice is spelled out rather than summarised.
const OWN_NOTICE = `Copyright (c) 2026 ${authorName}. MIT licensed.`
const UPSTREAM_NOTICE = 'Copyright (c) 2024 umo-team. MIT licensed.'
// Relative, so it resolves to the copy that ships beside whatever page this is running on.
const LICENSE_URL = './LICENSE'
</script>

<style lang="less" scoped>
.pdoc-about {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 0 8px;
  line-height: 1.6;
  text-align: center;

  img {
    margin-bottom: 16px;
  }

  p {
    margin: 2px 0 !important;
  }

  .pdoc-about-name {
    font-size: 15px;
    font-weight: 600;
  }

  .pdoc-about-notice {
    font-size: 12px;
    color: var(--pdoc-text-color-secondary);
  }

  a {
    color: var(--pdoc-primary-color);
    font-weight: 500;
    font-size: 12px;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}

:deep(.pdoc-divider) {
  margin: 20px 0 12px;
}
</style>
