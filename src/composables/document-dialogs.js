/**
 * Where the Open & Load dialog's open state lives.
 *
 * The dialog's markup belongs to one component and the control that opens it belongs to another,
 * and neither is an ancestor of the other, so provide/inject cannot reach between them. It used to
 * be bridged by finding the old toolbar button in the DOM and clicking it -
 * `document.querySelector('[data-testid="open-json"]').click()` - which silently did nothing the
 * moment that button was taken off the toolbar, because the guard around it was `if (btn)`.
 *
 * One editor per page holds one of these dialogs, so a module-level ref is the whole state.
 */
import { ref } from 'vue'

const loadDialogVisible = ref(false)

export const useDocumentDialogs = () => ({
  loadDialogVisible,
  openLoadDialog: () => {
    loadDialogVisible.value = true
  },
  closeLoadDialog: () => {
    loadDialogVisible.value = false
  },
})
