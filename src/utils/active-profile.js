// What the block under the cursor is actually styled with.
//
// Since profiles became CSS rules, a block styled entirely by its profile carries no font attributes
// of its own, so a toolbar that reads only node attributes and marks shows a default while the page
// shows something else. The controls have to fall back to the profile the block follows.

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'blockquote',
  'tableCell',
  'tableHeader',
])

/**
 * The profile the current selection sits in, or null.
 *
 * Walks out from the selection to the nearest block that names a profile, so a cursor inside a list
 * item or a table cell still finds the paragraph's profile.
 */
export const profileForSelection = (state, profiles = []) => {
  if (!state?.selection) {
    return null
  }
  const list = Array.isArray(profiles) ? profiles : []
  if (list.length === 0) {
    return null
  }
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth)
    if (!node || !BLOCK_TYPES.has(node.type.name)) {
      continue
    }
    const id = node.attrs?.numberingProfileId
    if (!id) {
      continue
    }
    const profile = list.find((item) => item?.id === id)
    if (profile) {
      return profile
    }
  }
  return null
}

/**
 * The value a toolbar control should show: what the user set on this block, else what its profile
 * gives it, else nothing. `attribute` is the mark or node attribute the control owns.
 */
export const effectiveTextStyle = (state, profiles, attribute, own) => {
  if (own) {
    return own
  }
  const profile = profileForSelection(state, profiles)
  const value = profile?.[attribute]
  return value === '' || value === undefined || value === null ? null : value
}
