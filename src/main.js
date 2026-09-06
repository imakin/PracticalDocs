import { createApp } from 'vue'

import App from './app.vue'
import { usePracticalDocs } from './components'

const app = createApp(App)

const options = {}

app.use(usePracticalDocs, options)

app.mount('#app')
