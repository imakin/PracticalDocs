/**
 * The browser's own page zoom (Ctrl+plus, Ctrl+minus), estimated, so the export can warn about it.
 *
 * A zoomed browser lays text out at the zoomed size, and fonts do not scale exactly: line heights and
 * glyph widths come out a fraction different. The pagination engine measures that layout, while
 * Chrome prints the page unzoomed, so the printed pages run longer than the sheets on screen and a
 * page's closing band spills onto a page of its own. Measured on the writer's thesis: the same export
 * printed 88 pages from a tab at 110% and 82 from one at 100%, for 81 sheets on screen. A device pixel
 * ratio from the operating system's display scaling does not do this - emulated at 1.1, still 82.
 *
 * No browser reports its zoom. `devicePixelRatio` is display scaling times zoom, so it cannot tell the
 * two apart alone. `outerWidth` is in screen pixels and `innerWidth` in CSS pixels, so their ratio is
 * the zoom plus the window frame - and a side panel inflates it with no zoom at all. So both are asked,
 * and a zoom is reported only when what is left of the pixel ratio after it is a display scaling
 * Windows actually offers. Anything else is `null`: not known, and nothing is said.
 */
const DISPLAY_SCALES = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 3.5]
const ZOOM_LEVELS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
]
// The window frame alone moves the ratio by about 1 per cent: 1680 against 1664 on the writer's screen.
const FRAME_TOLERANCE = 0.03

export const estimateBrowserZoom = ({ outerWidth, innerWidth, devicePixelRatio } = {}) => {
  if (!(outerWidth > 0) || !(innerWidth > 0) || !(devicePixelRatio > 0)) {
    return null
  }
  const ratio = outerWidth / innerWidth
  if (Math.abs(ratio - 1) <= FRAME_TOLERANCE) {
    return 1
  }
  const display = devicePixelRatio / ratio
  if (!DISPLAY_SCALES.some((scale) => Math.abs(display - scale) <= FRAME_TOLERANCE * scale)) {
    return null
  }
  return ZOOM_LEVELS.reduce((best, level) =>
    Math.abs(level - ratio) < Math.abs(best - ratio) ? level : best,
  )
}

export const browserZoom = () =>
  typeof window === 'undefined' ? null : estimateBrowserZoom(window)
