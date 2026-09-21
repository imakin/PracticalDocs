import { createApp } from 'vue'

// KaTeX's own stylesheet, bundled, rather than fetched from a CDN while the page is running.
//
// It is what lays a formula out, and the pagination engine measures a formula by the box that layout
// produces. A document exported before the stylesheet had arrived printed its mathematics unstyled:
// the MathML copy KaTeX emits for screen readers is only hidden by this file, so every formula was
// drawn twice and stood twice as tall - and the export gained pages that the screen never had.
//
// Here in the application's entry rather than inside the editor component, on purpose. Lib mode
// inlines every asset it meets, and KaTeX's twenty font faces turned the published stylesheet from
// 523 kB into 1.9 MB. A host that installs the package keeps the behaviour it has today, where the
// stylesheet comes from `cdnUrl`; the application this repository ships carries its own.
import 'katex/dist/katex.min.css'

import App from './app.vue'
import { usePracticalDocs } from './components'

const app = createApp(App)

const options = {}

app.use(usePracticalDocs, options)

app.mount('#app')
