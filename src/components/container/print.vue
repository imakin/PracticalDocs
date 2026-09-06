<template>
  <iframe ref="iframeRef" class="pdoc-print-iframe" :srcdoc="iframeCode" />
  <modal
    :visible="askVisible"
    width="420px"
    :header="printing ? t('print.title') : t('export.pdf.title')"
    :confirm-btn="printing ? t('print.confirm') : t('export.pdf.confirm')"
    destroy-on-close
    @close="cancelPrint"
    @confirm="confirmPrint"
  >
    <div class="pdoc-print-dialog">
      <p class="pdoc-print-dialog-message">
        {{ printing ? t('print.message') : t('export.pdf.message') }}
      </p>
      <!--
        The language the document is written in, not the language of this interface. It reaches the
        exported file as `<html lang>`, which is what a screen reader and an accessibility checker
        believe - and it was hardcoded to Chinese for every document this editor ever exported.
      -->
      <t-input v-model="draftLanguage" :label="t('print.language')" />
      <p class="pdoc-print-dialog-hint">{{ t('print.languageHint') }}</p>
      <!--
        A document whose sections use different paper cannot yet be printed on that paper: the
        canvas is as wide as the widest sheet, and a canvas wider than the page makes Chrome shrink
        the whole document to fit. Saying so here beats letting it be discovered in the PDF.
      -->
      <p v-if="mixedPaperNotice" class="pdoc-print-dialog-hint">
        {{ t('print.mixedPaperNote') }}
      </p>
    </div>
  </modal>
</template>

<script setup>
import { documentSections } from '@/extensions/page-break'
import { sameGeometry, sheetSizeOf } from '@/utils/page-sections'

const container = inject('container')
const editor = inject('editor')
const printing = inject('printing')
const exportFile = inject('exportFile')
const page = inject('page')
const options = inject('options')

const iframeRef = $ref(null)
let iframeCode = $ref('')
const getStylesHtml = () => {
  return Array.from(document.querySelectorAll('link, style'))
    .map((item) => item.outerHTML)
    .join('')
}

const getPlyrSprite = () => {
  return document.querySelector('#sprite-plyr')?.innerHTML || ''
}

// The bottom margin becomes a real block, instead of invisible page padding.
//
// This is the same idea the product is built on: space you cannot see is space you cannot control.
// The engine already inserts a spacer at every page boundary, holding the leftover column space plus
// the bottom margin plus the sheet gap plus the next page's top margin. Print has no sheet gap and
// keeps its top margin as `@page` padding, so the band is the spacer minus those two, which is
// exactly the leftover plus the bottom margin - the strip a page number belongs in.
//
// `break-after: page` on the band makes the page end there rather than wherever Chrome would choose.
// That is a deliberate trade: the export follows the engine instead of judging it independently. It
// is what WYSIWYG means here, and it is why the parity test's page-start checks are no longer an
// independent verdict.
const CM_PER_PX = 2.54 / 96

// Every page's margins become real blocks, so `@page` needs no padding at all.
//
// The canvas already starts with `.pdoc-page-node-header` and ends with `.pdoc-page-node-footer`, each
// exactly one margin tall - real elements, not invisible space. What was missing was the pair in the
// middle of the document, and the engine's spacer already holds precisely that: the leftover column
// space, the ending page's bottom margin, the sheet gap, and the next page's top margin. Print has no
// gap, so the spacer splits into two blocks:
//
//   [ leftover + bottom margin ]  break-after: page   <- the page number lives here
//   [ top margin ]                                    <- opens the next page
/**
 * The geometry of each sheet, in cm, as the export needs it.
 *
 * The engine already solved which section each sheet belongs to, so this reads that answer rather
 * than working out a second one - two answers to one question is the drift ADR 0002 exists to
 * prevent. Before the engine has solved, or past the last sheet, everything falls back to the
 * document settings, which is what the whole document was drawn at before sections existed.
 */
const sheetGeometry = () => {
  const state = editor.value?.state
  const sections = state ? documentSections(state.doc, page.value) : []
  const storage =
    editor.value?.extensionStorage?.pagination ||
    editor.value?.storage?.pagination
  const owners = (storage?.sheets || []).map((sheet) => sheet.section ?? 0)
  const fallback = sections[0] ?? {
    size: page.value?.size,
    orientation: page.value?.orientation,
    margin: page.value?.margin,
  }
  const at = (sheet) => sections[owners[sheet] ?? 0] ?? fallback
  return {
    count: owners.length,
    mixed:
      sections.length > 1 &&
      sections.some((section) => !sameGeometry(section, sections[0])),
    sections,
    section: (sheet) => String(owners[sheet] ?? 0),
    height: (sheet) => sheetSizeOf(at(sheet)).height,
    marginTop: (sheet) => Number(at(sheet)?.margin?.top) || 0,
    marginBottom: (sheet) => Number(at(sheet)?.margin?.bottom) || 0,
  }
}

const convertSpacersToMarginBands = (root, numbersBySheet) => {
  // Only documents that actually carry page numbers take this path. Everything else exports the way
  // it always has, with Chrome paginating freely, so the PDF parity test keeps being an independent
  // verdict on the engine rather than a tautology - it is what caught the page-break drift. The bands
  // exist because a number has to be drawn in the margin, and nothing else needs them.
  if (numbersBySheet.size === 0) {
    // Still strip the spacers. They are screen-only decorations sized with the sheet gap included;
    // leaving them in stacks their blank space on top of Chrome's own page breaks. Forgetting this
    // turned a 10-sheet document into a 14-page export.
    for (const spacer of root.querySelectorAll('.pdoc-page-spacer')) {
      spacer.remove()
    }
    return
  }
  // Per sheet, because a section can be drawn on different paper: the band closing sheet n is that
  // sheet's bottom margin plus whatever is left over, and the band opening sheet n+1 is sheet n+1's
  // top margin. With one geometry throughout - nearly every document - every lookup returns the same
  // number the document settings used to give.
  const geometry = sheetGeometry()
  const marginTopAt = (sheet) => geometry.marginTop(sheet) / CM_PER_PX
  const marginBottomAt = (sheet) => geometry.marginBottom(sheet) / CM_PER_PX
  const gapPx = 16

  const addNumber = (host, entry, edge) => {
    if (!entry) return
    const label = document.createElement('div')
    label.className = 'pdoc-page-number pdoc-profile-page-number'
    label.textContent = entry.text
    // Sit inside the margin strip rather than against the paper edge, mirroring what the engine does
    // on screen so the two agree.
    const inset =
      edge === 'top'
        ? marginTopAt(entry.sheet) * 0.35
        : marginBottomAt(entry.sheet) * 0.35
    label.style.cssText = [
      'position: absolute',
      'left: 0',
      'right: 0',
      `${edge === 'top' ? 'top' : 'bottom'}: ${inset.toFixed(2)}px`,
      `text-align: ${entry.align === 'center' ? 'center' : entry.align}`,
    ].join(';')
    host.appendChild(label)
  }

  // A manual page break carries its own `break-before: page`. The engine also puts a spacer there, and
  // that spacer becomes a band that ends the page. Both firing gives two breaks at one point and an
  // extra blank page, which is exactly what the export did. The bands are authoritative here, so the
  // element's own break is turned off.
  for (const brk of root.querySelectorAll('.pdoc-page-break')) {
    brk.style.breakBefore = 'auto'
    brk.style.pageBreakBefore = 'auto'
  }

  const spacers = [...root.querySelectorAll('.pdoc-page-spacer')]
  spacers.forEach((spacerSpan, index) => {
    const screenHeight = Number.parseFloat(spacerSpan.style.height) || 0
    const closing = Math.max(
      marginBottomAt(index),
      screenHeight - gapPx - marginTopAt(index + 1),
    )
    // The engine's spacer is a <span>. A <div> inside a <span> is invalid nesting, and the export
    // serialises and re-parses this HTML twice, at which point the parser hoists the number out of
    // the span again. Measured: the number then vanishes from some bands and not others. So the band
    // is a real <div> that replaces the span rather than the span dressed up as one.
    const spacer = document.createElement('div')
    spacerSpan.replaceWith(spacer)
    spacer.className = 'pdoc-page-band pdoc-page-band-closing'
    // The band closes this sheet, so it prints on this sheet's paper. Named here rather than left to
    // be carried from a neighbour: an element that names no page takes the canvas's name, and a page
    // name that changes and changes back is two forced breaks and two blank sheets.
    spacer.dataset.pdocSection = geometry.section(index)
    spacer.style.cssText = [
      `height: ${closing.toFixed(2)}px`,
      'box-sizing: border-box',
      'display: block',
      'position: relative',
      'break-after: page',
      'page-break-after: always',
    ].join(';')
    spacer.textContent = ''
    // A number belongs to the page it is printed on, and which band holds it depends on where on that
    // page it sits: the closing band is the ending page's bottom margin, the opening band is the next
    // page's top margin. Putting every number in the closing band is what made the export ignore the
    // position and print them all at the foot of the page.
    const closingEntry = numbersBySheet.get(index)
    if (closingEntry?.edge === 'bottom') {
      addNumber(spacer, closingEntry, 'bottom')
    }

    const opening = document.createElement('div')
    opening.className = 'pdoc-page-band'
    // This one opens the next sheet, so it belongs to the next sheet's section.
    opening.dataset.pdocSection = geometry.section(index + 1)
    opening.style.cssText = [
      `height: ${marginTopAt(index + 1).toFixed(2)}px`,
      'box-sizing: border-box',
      'display: block',
      'position: relative',
    ].join(';')
    const openingEntry = numbersBySheet.get(index + 1)
    if (openingEntry?.edge === 'top') {
      addNumber(opening, openingEntry, 'top')
    }
    spacer.after(opening)
  })

  // The last sheet has no spacer after it, so it gets a band of its own. Putting the number in the
  // canvas's existing footer does not work: the footer follows the text rather than sitting at the
  // foot of the page, so on a short last page the number floated mid-page. This band snaps to the
  // page boundary like every other, and the footer's own margin becomes redundant.
  // The first page's top margin is the canvas header, which is already a real block.
  const first = numbersBySheet.get(0)
  const header = root.querySelector('.pdoc-page-node-header')
  if (first?.edge === 'top' && header) {
    header.style.position = 'relative'
    header.style.overflow = 'visible'
    addNumber(header, first, 'top')
  }

  const last = numbersBySheet.get(spacers.length)
  const footer = root.querySelector('.pdoc-page-node-footer')
  if (last?.edge === 'bottom') {
    const band = document.createElement('div')
    band.className = 'pdoc-page-band pdoc-page-band-closing'
    band.dataset.last = 'true'
    band.dataset.pdocSection = geometry.section(spacers.length)
    band.style.cssText = [
      `height: ${marginBottomAt(spacers.length).toFixed(2)}px`,
      'box-sizing: border-box',
      'display: block',
      'position: relative',
    ].join(';')
    addNumber(band, last, 'bottom')
    // Into the text flow, not before the footer. `.pdoc-page-content` is a flex container and the
    // footer is one of its flex items, so a band placed there is laid out by flex rather than after
    // the last line - measured at 96px from the top of the document, stretched to 5515px tall.
    const flow =
      root.querySelector('.ProseMirror') ||
      root.querySelector('.pdoc-page-node-content') ||
      root.querySelector('.pdoc-page-content')
    flow?.appendChild(band)
    if (footer) {
      footer.style.height = '0px'
    }
  }
}

// The padded canvas height is an on-screen decoration; print gets its height from the flow.
const stripScreenPagination = (htmlContent) => {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = htmlContent

  // The engine drew these absolutely, in screen coordinates. Their text is what matters; the bands
  // below place it.
  const numbersBySheet = new Map()
  for (const element of tempDiv.querySelectorAll('.pdoc-page-number')) {
    const sheet = Number(element.dataset.sheet)
    if (Number.isFinite(sheet)) {
      numbersBySheet.set(sheet, {
        sheet,
        text: element.textContent || '',
        align: element.dataset.align || 'center',
        edge: element.dataset.edge || 'bottom',
      })
    }
    element.remove()
  }

  for (const sheet of tempDiv.querySelectorAll('.pdoc-page-content')) {
    sheet.style.removeProperty('--pdoc-page-total-height')
  }
  // The drawn sheets are screen decoration, placed in screen coordinates. Print draws its own paper.
  for (const sheet of tempDiv.querySelectorAll('.pdoc-page-sheet')) {
    sheet.remove()
  }
  convertSpacersToMarginBands(tempDiv, numbersBySheet)
  carrySectionNames(tempDiv)
  return tempDiv.innerHTML
}

/**
 * Give every element in the flow the section it prints in.
 *
 * A named page is not inherited the way a colour is, but an element that names none takes the name
 * of the box that holds it - so the header and footer blocks took the canvas's name. After the last
 * block that is a change of page name, which is a forced break, and the export grew a blank sheet at
 * the end.
 *
 * Nothing is guessed: an element with no name of its own takes the name of the last element before
 * it that had one, which is the section it is sitting in.
 */
const carrySectionNames = (root) => {
  const canvas = root.querySelector('.pdoc-page-content')
  if (!canvas?.querySelector('[data-pdoc-section]')) {
    return
  }
  let current = null
  const visit = (element) => {
    for (const child of [...element.children]) {
      if (child.hasAttribute('data-pdoc-section')) {
        current = child.getAttribute('data-pdoc-section')
      } else if (child.querySelector('[data-pdoc-section]')) {
        visit(child)
      } else if (current !== null) {
        child.setAttribute('data-pdoc-section', current)
      }
    }
  }
  visit(canvas)
}

const getContentHtml = () => {
  const originalContent =
    document.querySelector(`${container} .pdoc-page-content`)?.outerHTML || ''
  return prepareEchartsForPrint(stripScreenPagination(originalContent))
}
// 因echart依赖于组件动态展示，打印时效果无法通过html实现，所以通过转成图片方式解决
const prepareEchartsForPrint = (htmlContent) => {
  // 创建一个临时DOM容器用于处理HTML内容
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = htmlContent

  // 找到所有需要转换的ECharts实例
  const charts = tempDiv.querySelectorAll('.pdoc-node-echarts-body')
  for (const chartElement of charts) {
    const chartInstance = echarts.getInstanceByDom(chartElement)
    if (chartInstance) {
      // 使用getDataURL方法获取图表的base64图片数据
      const imgData = chartInstance.getDataURL({
        type: 'png', // 可以是'png'或'jpeg'
        pixelRatio: 2, // 提高分辨率，默认是1//分辨率太高会慢
        backgroundColor: '#fff', // 背景颜色，默认是透明
      })

      // 创建一个新的img元素并设置其src属性为图表的base64图片数据
      const imgElement = document.createElement('img')
      imgElement.src = imgData
      imgElement.style.width = '100%' // 确保图片宽度适合容器，根据实际情况调整

      // 替换原图表元素为img元素
      if (chartElement && chartElement.parentNode) {
        chartElement.parentNode.replaceChild(imgElement, chartElement)
      }
    }
  }
  return tempDiv.innerHTML
}

const defaultLineHeight = $computed(
  () => options.value.dicts?.lineHeights.find((item) => item.default)?.value,
)

/**
 * What the export has to undo when a document's sections are not all drawn the same way.
 *
 * **The paper does not change in the PDF yet.** Chrome can do it - a named `@page` rule per section
 * and a `page` property on its blocks, measured working - but the canvas cannot. On screen every
 * sheet is drawn on one canvas as wide as the widest, and Chrome's print scales a document down to
 * fit its narrowest page: with a landscape section in a portrait document that is 21/29.7, and
 * **everything** comes out at 70 per cent - the text column included. Measured on a real thesis: a
 * 14.6 cm column printed at 10.3 cm, on a page that then held half again as much text as the screen
 * did. The page count and the page sizes were both right, which is why this went unnoticed for a
 * while; nothing was checking the scale.
 *
 * Until the canvas can be the width of each page rather than of the widest, a mixed document prints
 * on the first section's paper - at full size and in the right column. Laying it out at one paper
 * also means the screen's page boundaries are not the export's, so where the page numbers land does
 * not match the screen either. The export dialog says both rather than leaving them to be found in
 * the PDF.
 *
 * So this returns the two things that have to be undone: the canvas back to one page wide, and the
 * blocks back to no inset. Both exist only on screen, and both are wrong on paper.
 */
const getSectionPageRules = () => {
  const geometry = sheetGeometry()
  if (!geometry.mixed) {
    return ''
  }
  const [first] = geometry.sections
  const paper = sheetSizeOf(first)
  return `
      /* The canvas is as wide as the widest sheet on screen, and a canvas wider than the page is
         what makes Chrome shrink the whole document to fit. One paper, one width. */
      .pdoc-page-content { width: ${paper.width}cm !important; }
      /* On screen a narrower sheet is centred on that canvas and its blocks carry the gutter as an
         inline margin. Printed on one paper the gutter is a margin nobody asked for. */
      [data-pdoc-section] {
        --pdoc-section-left: 0px;
        --pdoc-section-right: 0px;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }`
}

/**
 * Where each printed page ends, in pixels down the flow.
 *
 * The running total of the sheet heights the engine solved. A constant page height was enough while
 * every sheet was the same; a section can now be drawn on different paper. Empty when the engine has
 * not solved, in which case the script falls back to the constant.
 */
const printPageBottoms = () => {
  const geometry = sheetGeometry()
  const bottoms = []
  let total = 0
  for (let sheet = 0; sheet < geometry.count; sheet += 1) {
    total += geometry.height(sheet) / CM_PER_PX
    bottoms.push(Math.round(total * 100) / 100)
  }
  return bottoms
}

const getIframeCode = () => {
  const { orientation, size, margin, background } = page.value
  const hasPageNumbers =
    page.value.pageNumber?.enabled === true &&
    document.querySelector(
      `${container} .pdoc-page-content > .pdoc-page-number`,
    ) !== null
  const sectionRules = getSectionPageRules()
  /* eslint-disable */
  return `
    <!DOCTYPE html>
    <html lang="${page.value.language || 'en-US'}" theme-mode="${options.value.theme}">
    <head>
      <title>${options.value.document?.title}</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      ${getStylesHtml()}
      <style>
      html{
        margin: 0;
        padding: 0;
        overflow: visible;
      }
      body{
        margin: 0;
        padding: 0;
        background-color: ${background};
        -webkit-print-color-adjust: exact;
      }
      .pdoc-editor-container{
        background-color: ${background} !important;
      }
      .pdoc-page-content{
        transform: scale(1) !important;
        overflow: hidden;
        /* The page numbers are absolutely positioned against this box. */
        position: relative;
      }
      @page {
        size: ${orientation === 'portrait' ? size?.width : size?.height}cm ${orientation === 'portrait' ? size?.height : size?.width}cm;
        /* With page numbers the margins are real blocks in the flow, so the page needs no padding of
           its own: invisible space is space nothing can be placed in. Without them nothing has to be
           drawn in the margin, and the old padding keeps Chrome paginating freely. */
        padding: ${hasPageNumbers ? '0' : `${margin?.top}cm 0 ${margin?.bottom}cm`};
        margin: 0;
        background-color: ${background};
      }
      ${sectionRules}
      ${hasPageNumbers ? '' : '@page:first { padding-top: 0; }'}
      @page:last {
        ${hasPageNumbers ? '' : 'padding-bottom: 0;'}
        page-break-after: avoid;
      }
      .pdoc-page-band {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      </style>
    </head>
    <body class="is-print">
      <div id="sprite-plyr" style="display: none;">
      ${getPlyrSprite()}
      </div>
      <div class="pdoc-editor-container" style="line-height: ${defaultLineHeight};" aria-expanded="false">
        <div class="tiptap pdoc-editor" translate="no">
          ${getContentHtml()}
        </div>
      </div>
      <script>
        // A page's closing band has to end exactly on the page boundary. Its height is computed from
        // screen measurements, and text renders a fraction differently here, so half a pixel of drift
        // is enough to push the whole band onto the next page - which is what an early attempt did.
        // Rather than predict the discrepancy, each band measures itself once the document has laid
        // out and snaps to the boundary. Bands are adjusted in order, because moving one moves the
        // rest.
        const snapPageBands = () => {
          // Where each page ends, in pixels down the flow. A constant page height was enough while
          // every sheet was the same; a section can now be drawn on different paper, so the
          // boundaries are the running total of the real heights. With one geometry throughout this
          // is still (index + 1) * pageHeight, exactly as before.
          const pageBottoms = ${JSON.stringify(printPageBottoms())}
          const pageHeight = ${orientation === 'portrait' ? size?.height : size?.width} / 2.54 * 96
          if (!(pageHeight > 0)) return
          const bands = Array.from(document.querySelectorAll('.pdoc-page-band-closing'))
          const origin = document.querySelector('.pdoc-page-content')?.getBoundingClientRect().top ?? 0
          bands.forEach((band, index) => {
            band.style.height = '0px'
            const top = band.getBoundingClientRect().top - origin
            // The last band has no break-after rule to end the page for it, so landing exactly on
            // the boundary lets a fraction of a pixel spill it onto a page of its own. One pixel
            // short is invisible and cannot overflow. (No backticks in here: this whole script sits
            // inside a template literal, and a backtick would end it.)
            const target =
              (pageBottoms[index] ?? (index + 1) * pageHeight) -
              (band.dataset.last ? 1 : 0)
            // No minimum height. Measured: clamping to the bottom margin was what broke this - where
            // the text ran 4.48px long, the clamp pushed the band past the page boundary and Chrome
            // moved the whole band, and its page number, onto the next page. Landing exactly on the
            // boundary is the whole point; a bottom margin a few pixels short is invisible, a page
            // number on the wrong page is not.
            band.style.height = Math.max(0, target - top) + 'px'
          })
        }
        document.addEventListener("DOMContentLoaded", () => {
          snapPageBands()
          // Web fonts land after the first layout and change the line heights under the bands.
          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => snapPageBands())
          }
        })
        // The last word before the pages are actually cut. Everything above is a guess at when layout
        // has settled; this is the moment it has to be true.
        window.addEventListener('beforeprint', () => snapPageBands())
        document.addEventListener("DOMContentLoaded", (event) => {
          const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
              if (mutation.removedNodes) {
                Array.from(mutation.removedNodes).forEach(node => {
                  if (node?.classList?.contains('pdoc-page-watermark')) {
                    location.reload();
                  }
                });
              }
            });
          });
        });
      <\/script>
    </body>
    </html>`
  /* eslint-enable */
}

let askVisible = $ref(false)
let draftLanguage = $ref('en-US')
// Whether this export will print every page on one paper although the document does not use one.
// Worked out when the dialog opens, because that is when the geometry is read.
let mixedPaperNotice = $ref(false)

/**
 * Ask before printing, and let the writer say what the document is written in.
 *
 * This was a plain confirm with a message in it. The language field is the reason it is a dialog of
 * its own now: it is the one thing about the exported file that the editor cannot know and the
 * writer can, and it is easiest to answer at the moment they are exporting.
 */
const printPage = () => {
  editor.value?.commands.blur()
  draftLanguage = page.value.language || 'en-US'
  mixedPaperNotice = sheetGeometry().mixed
  // Built when the dialog opens, not only when it is confirmed. The export document is what the
  // pagination and bookmark tests read to see what would be printed, and they must not have to press
  // a button that opens Chrome's print preview to get it. It is built again on confirm, because by
  // then the writer may have changed the language.
  iframeCode = getIframeCode()
  askVisible = true
}

const closeAsk = () => {
  askVisible = false
  printing.value = false
  exportFile.value.pdf = false
}

const cancelPrint = () => {
  closeAsk()
}

const confirmPrint = () => {
  const next = String(draftLanguage || '').trim() || 'en-US'
  // Remembered on the page settings, so it is saved with the document and the next export does not
  // ask again from scratch.
  if (page.value.language !== next) {
    page.value.language = next
  }
  // Built after the language is set, because the language is in it.
  iframeCode = getIframeCode()
  askVisible = false
  setTimeout(() => {
    if (iframeRef && iframeRef.contentWindow) {
      iframeRef.contentWindow.print()
    }
    printing.value = false
    exportFile.value.pdf = false
  }, 400)
}

watch(
  () => [printing.value, exportFile.value.pdf],
  (value) => {
    if (!value[0] && !value[1]) {
      return
    }
    printPage()
  },
)
</script>

<style lang="less" scoped>
.pdoc-print-dialog {
  .pdoc-print-dialog-message {
    margin: 0 0 16px;
    line-height: 1.6;
  }

  .pdoc-print-dialog-hint {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--pdoc-text-color-light, #8c8c8c);
  }
}

.pdoc-print-iframe {
  position: absolute;
  width: 0;
  height: 0;
  border: none;
  overflow: auto;
}
</style>
