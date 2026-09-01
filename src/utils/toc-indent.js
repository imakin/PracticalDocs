/**
 * How far a table of contents entry is indented.
 *
 * The contents used to be a `t-tree`, which indented by its own rule and drew connector lines to
 * explain the indent it had chosen. Neither was the user's to change. Indentation is now two values
 * on the `Table of Contents` profile: the level it starts at, and how much each level after that
 * adds. Setting the step to zero, or the starting level below the deepest heading, gives a flat list.
 *
 * Kept as a pure function so it can be checked without a browser, and so the contents and anything
 * else that has to line up with it cannot drift apart.
 */

// The built-in contents profile. A document map that names no profile uses this one, so "default"
// means a profile the user can open and edit rather than a set of numbers hidden in the code.
export const DEFAULT_TOC_PROFILE_ID = 'profile-toc'

export const DEFAULT_TOC_INDENT_FROM = 2
export const DEFAULT_TOC_INDENT_STEP = '2em'

const LENGTH = /^(-?\d*\.?\d+)\s*([a-z%]*)$/i

/**
 * The multiplier for a heading level: 0 for anything shallower than the starting level, 1 for the
 * starting level itself, and one more for each level below it.
 */
export const tocIndentDepth = (level, from = DEFAULT_TOC_INDENT_FROM) => {
  const at = Number(level)
  if (!Number.isFinite(at)) {
    return 0
  }
  // `Number(null)` is 0, and a starting level of 0 indents everything by one step more than asked.
  // Absent has to be tested before the value is read as a number - the same trap that once made
  // every plain page break restart the page count at zero.
  const start =
    from === undefined || from === null || from === '' ? NaN : Number(from)
  const base = Number.isFinite(start) ? start : DEFAULT_TOC_INDENT_FROM
  return Math.max(0, at - base + 1)
}

/**
 * The CSS length to indent an entry by, or an empty string for none.
 *
 * A step given without a unit is read as em, which is what the field's placeholder shows. A step this
 * cannot parse is still honoured, as `calc()`, rather than being dropped: the user typed something
 * and a value they can see is worth more than silence.
 */
export const tocIndentOf = (level, profile) => {
  const step =
    profile?.tocIndent === undefined || profile?.tocIndent === null
      ? DEFAULT_TOC_INDENT_STEP
      : String(profile.tocIndent).trim()
  if (step === '') {
    return ''
  }
  const depth = tocIndentDepth(level, profile?.tocIndentFrom)
  if (depth === 0) {
    return ''
  }
  const match = LENGTH.exec(step)
  if (!match) {
    return `calc(${step} * ${depth})`
  }
  const size = Number(match[1])
  if (!Number.isFinite(size) || size === 0) {
    return ''
  }
  const unit = match[2] || 'em'
  // Rounded so that a third of an em does not print seventeen decimals into a style attribute.
  return `${Math.round(size * depth * 1000) / 1000}${unit}`
}

/**
 * Which profile a document map is styled by.
 *
 * A document map can name one, and more than one contents profile can exist - a thesis might want its
 * table of contents indented and its list of figures flat. The rule, in order:
 *
 * 1. the profile the map names, if it still exists and is a contents profile,
 * 2. the built-in `profile-toc`, which is what the picker calls Default,
 * 3. any contents profile at all, so a document whose built-in was deleted still looks deliberate,
 * 4. nothing, and the caller falls back to the values above.
 *
 * A map naming a profile that has been deleted falls to the default rather than losing its styling,
 * and it keeps the name: restoring the profile restores the map. Silently rewriting the map's choice
 * is what made one profile edit reach every block, back in ADR 0007.
 */
export const resolveTocProfile = (profiles, profileId) => {
  const list = Array.isArray(profiles) ? profiles.filter(Boolean) : []
  const contents = list.filter((profile) => profile.targetType === 'toc')
  if (contents.length === 0) {
    return null
  }
  if (profileId) {
    const named = contents.find((profile) => profile.id === profileId)
    if (named) {
      return named
    }
  }
  return (
    contents.find((profile) => profile.id === DEFAULT_TOC_PROFILE_ID) ||
    contents[0]
  )
}
