export function useState(key, editorOptions) {
  const options = editorOptions.value
  const storageKey = `practicaldocs:${options.editorKey || 'default'}:${key}`

  if (key === 'document') {
    // Not persisted. Restoring the document across a reload meant the editor came back holding a
    // title, and sometimes content, that nobody had asked for - and a stale title over an empty
    // document is exactly the case the autosave guard exists to catch. Opening a document is an
    // explicit act, through Buka / Load. Anything left in this key from an older build is cleared so
    // it cannot leak back in.
    try {
      localStorage.removeItem(storageKey)
    } catch {}
    return ref({ ...options.document })
  }
  if (key === 'recent') {
    return useStorage(storageKey, {
      fonts: [],
      colors: [],
      downloadedFonts: [],
    })
  }
  if (key === 'toolbar') {
    return useStorage(storageKey, {
      mode: options.toolbar.defaultMode || 'classic',
      show: options.toolbar.defaultShow || true,
    })
  }
  if (key === 'theme') {
    return useStorage(storageKey, options.theme || 'light')
  }
  if (key === 'skin') {
    return useStorage(storageKey, options.skin || 'default')
  }
  if (key === 'layout') {
    return useStorage(storageKey, options.page.layouts[0] || 'page')
  }
  throw new Error('[useStorage]', { cause: 'Key is not valid' })
}
