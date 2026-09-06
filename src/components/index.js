import 'virtual:svg-icons-register'

import PracticalDocs from './index.vue'
import PdocMenuButton from './menus/button.vue'
import PdocDialog from './modal.vue'
import PdocTooltip from './tooltip.vue'

const usePracticalDocs = {
  install: (app, options) => {
    app.provide('defaultOptions', options || {})
    app.component(PracticalDocs.name || 'PracticalDocs', PracticalDocs)
  },
}

export {
  PracticalDocs as default,
  PdocDialog,
  PracticalDocs,
  PdocMenuButton,
  PdocTooltip,
  usePracticalDocs,
}
