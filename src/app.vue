<template>
  <!--
    The page this editor is deployed as, and the page `npm run dev` serves. One file, so what ships is
    what the writer has been looking at all along - a second entry for production is a second way for
    the two to behave differently, which is how the editor came to be unable to save when it was
    embedded elsewhere.

    The editor fills the window. It used to sit inside a bordered box with a margin around it, which
    is a demonstration frame, not a product.
  -->
  <div class="pdoc-app">
    <practical-docs v-bind="options" />
  </div>
</template>

<script setup>
const options = $ref({
  locale: 'en-US',
  document: {
    title: 'file-identifier',
    // Deliberately empty on start. Restoring the last document from localStorage made every reload
    // begin from whatever happened to be cached, which hid bugs behind state nobody could describe
    // and made "I cannot reproduce it" the usual answer. Opening a document is now always an
    // explicit act, through the Open dialog. The cache is still written on save and is still
    // readable through that menu.
    content: '',
  },
  page: {
    layouts: ['page', 'web'],
    showBookmark: true,
  },
  // Where the diagram renderers, charts, media player and file type icons are fetched from at run
  // time: the site's own copy of what upstream's CDN used to serve (`editorExternal` in
  // `vite.config.js`). Nothing is fetched from cdn.umodoc.com, and leaving this out would fall back
  // to an unpinned `@latest` on unpkg.
  cdnUrl: './editor-external',
  // Nothing else is set here, on purpose. Saving, uploading and the document server's address are
  // the editor's own business now (`src/utils/save-to-server.js`), and mention suggestions,
  // templates and the user list are left empty because this deployment has no directory behind
  // them - the ones that used to be here were invented names, and they would have been shown to
  // real readers.
  onFileDelete() {
    // Nothing to do. Removing a picture from the document is enough: the next save sends only the
    // assets the document still refers to, and the server drops the rest from the document's folder.
  },
})
</script>

<style>
html,
body {
  height: 100vh;
  padding: 0;
  margin: 0;
  overflow: hidden;
}

.pdoc-app {
  position: relative;
  width: 100%;
  height: 100vh;
}
</style>
