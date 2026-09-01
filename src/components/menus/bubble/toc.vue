<template>
  <div class="umo-toc-profile-picker">
    <span class="umo-toc-profile-label">{{ t('toc.profile.label') }}</span>
    <t-select
      :value="current"
      size="small"
      :options="options"
      :popup-props="{ overlayInnerStyle: { maxHeight: '220px', overflowY: 'auto' } }"
      @change="apply"
    />
  </div>
</template>

<script setup>
import { getNumberingProfileList } from '@/extensions/document-references'
import { DEFAULT_TOC_PROFILE_ID } from '@/utils/toc-indent'

const editor = inject('editor')

/**
 * The profile picker for a document map.
 *
 * It lives here, on the selected block, because a map cannot be reached the way every other block
 * can: it is an atom whose rows are a view rather than content, so there is no text in it to select
 * and no cursor to put inside it. Without this the only way to style a map would be to have exactly
 * one contents profile and hope.
 */
// Read from storage, never through a command. A command dispatches a transaction even when it only
// reads, and a computed that dispatches re-runs itself: that is what hung the editor.
const contentsProfiles = $computed(() =>
  getNumberingProfileList(editor.value).filter(
    (profile) => profile.targetType === 'toc',
  ),
)

const options = $computed(() => {
  const named = contentsProfiles
    .filter((profile) => profile.id !== DEFAULT_TOC_PROFILE_ID)
    .map((profile) => ({ label: profile.name || profile.id, value: profile.id }))
  // The built-in is offered as Default rather than by name, so that the entry meaning "I have not
  // chosen" and the entry meaning "the built-in" are the same thing and cannot disagree.
  const builtIn = contentsProfiles.find(
    (profile) => profile.id === DEFAULT_TOC_PROFILE_ID,
  )
  return [
    {
      label: builtIn
        ? `${t('toc.profile.default')} (${builtIn.name || builtIn.id})`
        : t('toc.profile.default'),
      value: '',
    },
    ...named,
  ]
})

const current = $computed(() => {
  const chosen = editor.value?.getAttributes('toc')?.profileId || ''
  // A profile that has been deleted still shows as Default, which is what the map renders as. The
  // attribute keeps the name, so restoring the profile restores the map.
  return options.some((option) => option.value === chosen) ? chosen : ''
})

const apply = (value) => {
  editor.value?.commands.setTableOfContentsProfile?.(value || '')
}
</script>

<style lang="less" scoped>
.umo-toc-profile-picker {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;

  .umo-toc-profile-label {
    font-size: 12px;
    color: var(--umo-text-color-light);
    white-space: nowrap;
  }

  :deep(.t-select) {
    min-width: 150px;
  }
}
</style>
