/**
 * 资源加载方法（支持 JS 和 CSS）
 * @param {string} url - 资源地址
 * @param {'script'|'css'} [type='script'] - 资源类型，'script' | 'css'（默认 'script'）
 * @param {string} [id=''] - 资源 ID
 * @returns {Promise<void>} 加载成功 resolve，失败 reject
 */
export const loadResource = (url, type = 'script', id = '') => {
  const filename = url.split('/').pop()
  const resourceId = id === '' ? `${type || 'script'}-${filename}` : id

  return new Promise((resolve, reject) => {
    if (document.getElementById(resourceId)) {
      resolve()
      return
    }
    let element

    if (type === 'script') {
      // 加载 JS 脚本
      element = document.createElement('script')
      element.src = url
      element.id = resourceId
      element.type = 'text/javascript'
      // element.async = true

      element.onload = () => resolve()
      element.onerror = () => reject(new Error(`JS 脚本加载失败: ${url}`))
    } else if (type === 'css') {
      // 加载 CSS 样式
      element = document.createElement('link')
      element.rel = 'stylesheet'
      element.href = url
      element.id = resourceId

      element.onload = () => resolve()
      element.onerror = () => reject(new Error(`CSS 样式加载失败: ${url}`))
    } else {
      reject(new Error(`不支持的类型: ${type}`))
      return
    }

    document.head.appendChild(element)
  })
}

/**
 * Automatically loads a web font (such as Google Fonts) into the browser if it's not a standard system font.
 * @param {string} fontFamily - The font family name, e.g. "Poppins", "Inter", "Playfair Display"
 */
export const ensureFontFamilyLoaded = (fontFamily) => {
  if (!fontFamily || typeof document === 'undefined') return
  const fontName = String(fontFamily).split(',')[0].trim().replace(/^["']|["']$/g, '')
  if (!fontName) return

  const systemFonts = [
    'simsun', 'simhei', 'kaiti', 'kaiti_gb2312', 'fangsong', 'fangsong_gb2312',
    'stsong', 'stfangsong', 'microsoft yahei', 'pingfang sc', 'hiragino sans gb',
    'dengxian', 'youyuan', 'lisu', 'arial', 'times new roman', 'courier new',
    'georgia', 'verdana', 'tahoma', 'trebuchet ms', 'impact', 'sans-serif',
    'serif', 'monospace', 'cursive', 'fantasy', 'initial', 'inherit',
  ]

  if (systemFonts.includes(fontName.toLowerCase())) {
    return
  }

  const elementId = `google-font-${fontName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
  if (document.getElementById(elementId)) {
    return
  }

  const link = document.createElement('link')
  link.id = elementId
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&display=swap`
  document.head.appendChild(link)
}
