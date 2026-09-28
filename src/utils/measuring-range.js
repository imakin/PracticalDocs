/**
 * One Range for measuring text, reused, instead of a new one per measurement.
 *
 * A Range stays registered with its document until it is garbage collected, and the browser updates
 * every live one on every DOM mutation. The pagination engine made one per text node per measurement
 * and one per step of a binary search, so thousands were alive at once: profiled on the writer's
 * tesis8ag, **5.2 seconds** of one layout run went to `removeChild` inside ProseMirror, removing the
 * previous solve's spacers, and each solve was slower than the one before as the ranges piled up
 * between collections. `detach()` does not help - it has done nothing since the DOM standard dropped
 * it.
 *
 * Only for code that reads rects and lets go before anything else runs. A range handed to the
 * selection, or kept, needs its own.
 */
let shared = null

export const measuringRange = () => {
  if (!shared || shared.startContainer?.ownerDocument !== document) {
    shared = document.createRange()
  }
  return shared
}
