import { readdirSync, readFileSync } from 'node:fs'

import Vue from '@vitejs/plugin-vue'
import ReactivityTransform from '@vue-macros/reactivity-transform/vite'
import AutoImport from 'unplugin-auto-import/vite'
import { TDesignResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import VueMacros from 'unplugin-vue-macros/vite'
import { defineConfig } from 'vite'
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'

import pkg from './package.json'
import copyright from './src/utils/copyright'

// Plugin configurations
const vuePlugins = {
  VueMacros: VueMacros({
    plugins: {
      vue: Vue(),
    },
  }),
  AutoImport: AutoImport({
    dirs: ['./src/composables'],
    imports: ['vue', '@vueuse/core'],
    resolvers: [TDesignResolver({ library: 'vue-next', esm: true })],
    dts: './types/imports.d.ts',
    dtsMode: 'overwrite',
  }),
  Components: Components({
    directoryAsNamespace: true,
    dirs: ['./src/components'],
    resolvers: [TDesignResolver({ library: 'vue-next', esm: true })],
    dts: './types/components.d.ts',
  }),
  SvgIcons: createSvgIconsPlugin({
    iconDirs: [`${process.cwd()}/src/assets/icons`],
    symbolId: 'pdoc-icon-[name]',
    customDomId: 'pdoc-icons',
  }),
}

/**
 * Two builds from one source.
 *
 * `vite build` makes the **library** that npm publishes: `dist/practicaldocs.js` plus its stylesheet,
 * with Vue, Tiptap, ProseMirror and every dependency left external, because whoever installs the
 * package already has them.
 *
 * `vite build --mode app` makes the **site**: `dist-app/`, an index.html and its assets, everything
 * bundled, ready to copy onto a static server beside the storage server. It is the same entry the
 * dev server runs (`index.html` -> `src/main.js` -> `src/app.vue`), so what ships is what the writer
 * has been looking at all along rather than a second path that can behave differently - which is
 * exactly how the editor came to be unable to save when it was embedded elsewhere.
 *
 * `base: './'` so the folder can be served from a domain root or from a sub path without rebuilding.
 */
/**
 * The licence, carried into the built site.
 *
 * MIT asks one thing: the copyright notice and the permission notice are included in every copy of
 * the software. `npm pack` puts `LICENSE` in the package by itself, so the published package was
 * always covered - but a folder of static files copied onto a server is a copy too, and it carried
 * nothing. Emitted from the one `LICENSE` in the repository rather than a second copy kept in
 * `public/`, because two copies of a licence are two things that can disagree.
 */
const licenseFile = () => ({
  name: 'pdoc-license-file',
  // Served in development as well, so the link in the About dialog is not a 404 on the one machine
  // where it is looked at most.
  configureServer(server) {
    server.middlewares.use('/LICENSE', (_request, response) => {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.end(readFileSync(`${process.cwd()}/LICENSE`, 'utf8'))
    })
  },
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'LICENSE',
      source: readFileSync(`${process.cwd()}/LICENSE`, 'utf8'),
    })
  },
})

/**
 * What the editor loads at run time - diagram renderers, charts, the media player, file icons - served
 * by the site itself instead of by upstream's CDN.
 *
 * These were fetched from `https://cdn.umodoc.com`, a third party, whenever a document used them. The
 * same files are in `@umoteam/editor-external`, already a dependency, so the site carries the ones it
 * uses: a few megabytes out of a 60 MB package, copied at build time and never committed. The KaTeX
 * stylesheet that CDN also served is deliberately not among them - it overrode the bundled one and
 * moved every formula wherever the CDN happened to answer (`src/components/editor/index.vue`).
 *
 * `cdnUrl` in `src/app.vue` is `./editor-external`, which resolves next to `index.html` in the built
 * site and to `/editor-external` beside `/practicaldocs` in development.
 */
const EXTERNAL_ROOT = `${process.cwd()}/node_modules/@umoteam/editor-external`
const EXTERNAL_FILES = [
  'libs/mermaid/mermaid.min.js',
  'libs/echarts/echarts.min.js',
  'libs/plyr/plyr.css',
  'libs/plyr/plyr.min.js',
  'libs/plyr/plyr.svg',
  'libs/flowchart/raphael.min.js',
  'libs/flowchart/flowchart.js',
  'libs/plantuml/plantuml-encoder.min.js',
  ...readdirSync(`${EXTERNAL_ROOT}/icons/file`).map((name) => `icons/file/${name}`),
]
const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
}
const editorExternal = (mode) => ({
  name: 'pdoc-editor-external',
  configureServer(server) {
    server.middlewares.use('/editor-external', (request, response, next) => {
      const file = decodeURIComponent((request.url || '').split('?')[0]).replace(/^\//, '')
      if (!EXTERNAL_FILES.includes(file)) {
        next()
        return
      }
      const extension = file.slice(file.lastIndexOf('.'))
      response.setHeader('Content-Type', CONTENT_TYPES[extension] || 'application/octet-stream')
      response.end(readFileSync(`${EXTERNAL_ROOT}/${file}`))
    })
  },
  generateBundle() {
    // The library that npm publishes leaves this to the host, which sets its own `cdnUrl`.
    if (mode !== 'app') {
      return
    }
    for (const file of EXTERNAL_FILES) {
      this.emitFile({
        type: 'asset',
        fileName: `editor-external/${file}`,
        source: readFileSync(`${EXTERNAL_ROOT}/${file}`),
      })
    }
  },
})

const appBuildConfig = {
  target: 'es2018',
  outDir: 'dist-app',
  minify: 'esbuild',
  cssMinify: true,
  rollupOptions: {
    output: {
      banner: copyright,
    },
  },
}

// Build configuration
const buildConfig = {
  target: 'es2018',
  lib: {
    entry: `${process.cwd()}/src/components/index.js`,
    name: pkg.name,
    fileName: 'practicaldocs',
  },
  outDir: 'dist',
  copyPublicDir: false,
  minify: 'esbuild',
  cssMinify: true,
  rollupOptions: {
    output: [
      {
        banner: copyright,
        intro: `import './practicaldocs.css'`,
        format: 'es',
      },
    ],
    external: [
      'vue',
      /^@vueuse\/.*/,
      /^@tiptap\/.*/,
      /^prosemirror-*/,
      /^nzh\/.*/,
      ...Object.keys(pkg.dependencies),
    ],
    onwarn(warning, warn) {
      if (warning.code === 'UNUSED_EXTERNAL_IMPORT') return
      warn(warning)
    },
  },
}

const cssConfig = {
  preprocessorOptions: {
    less: {
      modifyVars: { '@prefix': 'pdoc' },
      javascriptEnabled: true,
      // 添加 Less 插件来排除特定类名
      plugins: [
        {
          install(less, pluginManager) {
            pluginManager.addPostProcessor({
              process(css) {
                return css.replace(/\.flex-center(\s|\{|,)[^}]*\}/g, '')
              },
            })
          },
        },
      ],
    },
  },
}

export default defineConfig(({ mode }) => ({
  base: mode === 'app' ? './' : '/practicaldocs',
  plugins: [
    ReactivityTransform(),
    ...Object.values(vuePlugins),
    licenseFile(),
    editorExternal(mode),
  ],
  css: cssConfig,
  build: mode === 'app' ? appBuildConfig : buildConfig,
  esbuild: {
    drop: ['debugger'],
    // Or the banner is minified away. It was: the built library carried no notice at all, and the
    // only reason the package was in order is that npm ships `LICENSE` on its own.
    legalComments: 'inline',
  },
  resolve: {
    alias: {
      '@': `${process.cwd()}/src`,
    },
  },
}))
