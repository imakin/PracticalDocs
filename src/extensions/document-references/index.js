import { Extension, mergeAttributes, Node } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { t } from '@/composables/i18n'
import {
  buildReferencePlan,
  getCrossReferenceText,
  getReferenceTargetOptionLabel,
} from '@/utils/document-references'
import { shortId } from '@/utils/short-id'

const SYNC_META = 'documentReferencesSync'
const TARGET_NODE_TYPES = new Set(['heading', 'image', 'table', 'paragraph'])

const normalizeText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const getLabels = () => ({
  heading: t('references.labels.section'),
  figure: t('references.labels.figure'),
  table: t('references.labels.table'),
  missing: t('references.missing'),
})

const getTargetType = (node) => {
  if (node.type.name === 'heading') {
    return 'heading'
  }
  if (node.type.name === 'paragraph') {
    return 'paragraph'
  }
  if (node.type.name === 'image') {
    return 'figure'
  }
  if (node.type.name === 'table') {
    return 'table'
  }
  if (node.type.name === 'footnoteReference') {
    return 'citation'
  }
  return null
}

const getTargetTitle = (node, targetType) => {
  if (targetType === 'table') {
    return normalizeText(node.attrs.caption)
  }
  if (targetType === 'citation') {
    return normalizeText(node.attrs.caption)
  }
  return normalizeText(node.textContent)
}

const getTargetId = (node, targetType) =>
  targetType === 'citation' ? node.attrs['data-fn-id'] : node.attrs.referenceId

const collectTargetDescriptors = (doc) => {
  const descriptors = []
  doc.descendants((node, pos) => {
    const targetType = getTargetType(node)
    if (!targetType || (targetType === 'figure' && node.attrs.inline)) {
      return
    }
    descriptors.push({
      pos,
      targetType,
      targetId: getTargetId(node, targetType),
      number: node.attrs.referenceNumber,
      label: node.attrs.referenceLabel,
      numberingProfileId: node.attrs.numberingProfileId,
      numberStyle: node.attrs.numberStyle,
      numberTemplate: node.attrs.numberTemplate,
      level: node.attrs.level,
      title: getTargetTitle(node, targetType),
    })
  })
  return descriptors
}

const createPlan = (doc, storage = {}) =>
  buildReferencePlan(collectTargetDescriptors(doc), {
    createId: () => shortId(10),
    labels: getLabels(),
    enabled: storage.numberingEnabled !== false,
    styles: storage.styles || {},
    templates: storage.templates || {},
    profiles: storage.profiles || [],
  })

const hasDifferentValue = (attrs, name, value) =>
  String(attrs[name] ?? '') !== String(value ?? '')

const applyTargetUpdates = (tr, updates) => {
  let changed = false
  updates.forEach((update) => {
    const node = tr.doc.nodeAt(update.pos)
    if (!node) {
      return
    }
    const attrs = { ...node.attrs }
    let nodeChanged = false
    if (update.targetType === 'citation') {
      if (hasDifferentValue(attrs, 'data-fn-id', update.targetId)) {
        attrs['data-fn-id'] = update.targetId
        nodeChanged = true
        changed = true
      }
    } else {
      if (hasDifferentValue(attrs, 'referenceId', update.targetId)) {
        attrs.referenceId = update.targetId
        nodeChanged = true
        changed = true
      }
      if (hasDifferentValue(attrs, 'referenceNumber', update.number)) {
        attrs.referenceNumber = update.number
        nodeChanged = true
        changed = true
      }
      if (hasDifferentValue(attrs, 'referenceLabel', update.label)) {
        attrs.referenceLabel = update.label
        nodeChanged = true
        changed = true
      }
      if (
        update.numberingProfileId &&
        hasDifferentValue(attrs, 'numberingProfileId', update.numberingProfileId)
      ) {
        attrs.numberingProfileId = update.numberingProfileId
        nodeChanged = true
        changed = true
      }
      if (update.profile) {
        if (
          update.profile.template &&
          hasDifferentValue(attrs, 'numberTemplate', update.profile.template)
        ) {
          // If existing node attribute has explicit newline \n, preserve it unless profile also defines newline or is forced
          const isCurrentMultiline = attrs.numberTemplate && attrs.numberTemplate.includes('\n')
          const isProfileMultiline = update.profile.template.includes('\n')
          if (!isCurrentMultiline || isProfileMultiline) {
            attrs.numberTemplate = update.profile.template
            nodeChanged = true
            changed = true
          }
        }
        if (
          update.profile.style &&
          hasDifferentValue(attrs, 'numberStyle', update.profile.style)
        ) {
          attrs.numberStyle = update.profile.style
          nodeChanged = true
          changed = true
        }
        if (
          !attrs.fontSize &&
          update.profile.fontSize &&
          hasDifferentValue(attrs, 'fontSize', update.profile.fontSize)
        ) {
          attrs.fontSize = update.profile.fontSize
          nodeChanged = true
          changed = true
        }
        if (
          !attrs.fontWeight &&
          update.profile.fontWeight &&
          hasDifferentValue(attrs, 'fontWeight', update.profile.fontWeight)
        ) {
          attrs.fontWeight = update.profile.fontWeight
          nodeChanged = true
          changed = true
        }
        if (
          !attrs.lineHeight &&
          update.profile.lineHeight &&
          hasDifferentValue(attrs, 'lineHeight', update.profile.lineHeight)
        ) {
          attrs.lineHeight = update.profile.lineHeight
          nodeChanged = true
          changed = true
        }
        if (
          update.profile.marginBottom &&
          (!attrs.margin || attrs.margin.bottom === undefined || attrs.margin.bottom === '')
        ) {
          attrs.margin = {
            ...(attrs.margin || {}),
            bottom: update.profile.marginBottom,
          }
          nodeChanged = true
          changed = true
        }
      }
    }
    if (nodeChanged) {
      tr.setNodeMarkup(update.pos, undefined, attrs)
    }
  })
  return changed
}

const applyCrossReferenceUpdates = (tr, targets) => {
  const targetMap = new Map(targets.map((target) => [target.targetId, target]))
  const references = []
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'crossReference') {
      references.push({ node, pos })
    }
  })

  let changed = false
  for (const { node, pos } of references) {
    const target = targetMap.get(node.attrs.targetId)
    const displayMode = node.attrs.displayMode || 'label'
    const nextAttrs = {
      ...node.attrs,
      targetType: target?.targetType || node.attrs.targetType || '',
      targetNumber: target?.number || '',
      targetText: target?.title || '',
      referenceText: getCrossReferenceText(target, displayMode, getLabels()),
      missing: !target,
    }
    const shouldUpdate = Object.keys(nextAttrs).some((name) =>
      hasDifferentValue(node.attrs, name, nextAttrs[name]),
    )
    if (shouldUpdate) {
      tr.setNodeMarkup(pos, undefined, nextAttrs)
      changed = true
    }
  }
  return changed
}

const createSyncTransaction = (state, storage) => {
  const { tr } = state
  const { targets, updates } = createPlan(state.doc, storage)
  const targetsChanged = applyTargetUpdates(tr, updates)
  const referencesChanged = applyCrossReferenceUpdates(tr, targets)
  storage.targets = targets
  if (!targetsChanged && !referencesChanged) {
    return null
  }
  tr.setMeta(SYNC_META, true)
  tr.setMeta('addToHistory', false)
  return tr
}

export const findActiveTarget = (state) => {
  if (!state) return null
  const { selection } = state
  if (
    selection instanceof NodeSelection &&
    ['image', 'table'].includes(selection.node?.type?.name) &&
    !(selection.node.type.name === 'image' && selection.node.attrs.inline)
  ) {
    return {
      node: selection.node,
      pos: selection.from,
      targetType: selection.node.type.name === 'image' ? 'figure' : 'table',
    }
  }

  const { $from } = selection
  if (!$from) return null
  const { depth: maxDepth } = $from
  for (let depth = maxDepth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (['image', 'table'].includes(node.type.name)) {
      if (node.type.name === 'image' && node.attrs.inline) {
        continue
      }
      return {
        node,
        pos: $from.before(depth),
        targetType: node.type.name === 'image' ? 'figure' : 'table',
      }
    }
  }
  return null
}

export const getTargetCaption = (target) =>
  target?.targetType === 'table'
    ? normalizeText(target.node.attrs.caption)
    : normalizeText(target?.node.textContent)

const escapeSelector = (value) => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return String(value).replaceAll('"', '\\"')
}

const focusTargetElement = (editor, targetId, targetType) => {
  const escapedId = escapeSelector(targetId)
  const selector =
    targetType === 'citation'
      ? `[data-fn-id="${escapedId}"]`
      : `[data-reference-id="${escapedId}"]`
  const element = editor.view.dom.querySelector(selector)
  if (!element) {
    return false
  }
  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
    inline: 'nearest',
  })
  return true
}

export const CrossReference = Node.create({
  name: 'crossReference',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      targetId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-target-id') || '',
      },
      targetType: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-target-type') || '',
      },
      displayMode: {
        default: 'label',
        parseHTML: (element) =>
          element.getAttribute('data-display-mode') || 'label',
      },
      targetNumber: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-target-number') || '',
      },
      targetText: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-target-text') || '',
      },
      referenceText: {
        parseHTML: (element) => element.textContent || '',
        default: '',
      },
      missing: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-missing') === 'true',
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-type="cross-reference"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const {
      targetId,
      targetType,
      displayMode,
      targetNumber,
      targetText,
      referenceText,
      missing,
    } = HTMLAttributes
    return [
      'a',
      mergeAttributes(this.options.HTMLAttributes, {
        class: 'umo-cross-reference',
        'data-type': 'cross-reference',
        'data-target-id': targetId,
        'data-target-type': targetType,
        'data-display-mode': displayMode,
        'data-target-number': targetNumber,
        'data-target-text': targetText,
        'data-missing': missing ? 'true' : 'false',
        href: `#reference-${targetId}`,
        contenteditable: 'false',
      }),
      referenceText || getLabels().missing,
    ]
  },
})

export const DocumentReferences = Extension.create({
  name: 'documentReferences',

  addStorage() {
    return {
      targets: [],
      numberingEnabled: true,
      styles: {
        heading: 'numeric',
        figure: 'numeric',
        table: 'numeric',
      },
      templates: {
        heading: '{number}',
        figure: '{label} {number}',
        table: '{label} {number}',
      },
      profiles: [
        {
          id: 'profile-paragraph',
          name: 'Normal (Text)',
          enabled: false,
          style: 'numeric',
          template: '',
          targetType: 'paragraph',
        },
        {
          id: 'profile-h1',
          name: 'Title 1 (H1)',
          enabled: true,
          style: 'roman-upper',
          template: 'BAB {number}\n',
          targetType: 'heading',
          level: 1,
        },
        {
          id: 'profile-h2',
          name: 'Title 2 (H2)',
          enabled: true,
          style: 'numeric',
          template: '{number}',
          targetType: 'heading',
          level: 2,
        },
        {
          id: 'profile-h3',
          name: 'Title 3 (H3)',
          enabled: true,
          style: 'numeric',
          template: '{number}',
          targetType: 'heading',
          level: 3,
        },
        {
          id: 'profile-h4',
          name: 'Title 4 (H4)',
          enabled: false,
          style: 'numeric',
          template: '{number}',
          targetType: 'heading',
          level: 4,
        },
        {
          id: 'profile-h5',
          name: 'Title 5 (H5)',
          enabled: false,
          style: 'numeric',
          template: '{number}',
          targetType: 'heading',
          level: 5,
        },
        {
          id: 'profile-h6',
          name: 'Title 6 (H6)',
          enabled: false,
          style: 'numeric',
          template: '{number}',
          targetType: 'heading',
          level: 6,
        },
        {
          id: 'profile-table',
          name: 'Tabel',
          enabled: true,
          style: 'numeric',
          template: 'Tabel {number}',
          targetType: 'table',
        },
        {
          id: 'profile-figure',
          name: 'Gambar',
          enabled: true,
          style: 'numeric',
          template: 'Gambar {number}',
          targetType: 'figure',
        },
      ],
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: [...TARGET_NODE_TYPES],
        attributes: {
          referenceId: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute('data-reference-id') || null,
            renderHTML: ({ referenceId }) =>
              referenceId
                ? {
                    'data-reference-id': referenceId,
                  }
                : {},
          },
          referenceNumber: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute('data-reference-number') || null,
            renderHTML: ({ referenceNumber }) =>
              referenceNumber
                ? {
                    'data-reference-number': referenceNumber,
                  }
                : {},
          },
          referenceLabel: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute('data-reference-label') || null,
            renderHTML: ({ referenceLabel }) =>
              referenceLabel
                ? {
                    'data-reference-label': referenceLabel,
                  }
                : {},
          },
          numberingProfileId: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute('data-numbering-profile-id') || null,
            renderHTML: ({ numberingProfileId }) =>
              numberingProfileId
                ? {
                    'data-numbering-profile-id': numberingProfileId,
                  }
                : {},
          },
          numberStyle: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute('data-number-style') || null,
            renderHTML: ({ numberStyle }) =>
              numberStyle
                ? {
                    'data-number-style': numberStyle,
                  }
                : {},
          },
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: ({ fontSize }) =>
              fontSize
                ? {
                    style: `font-size: ${fontSize}`,
                  }
                : {},
          },
          fontWeight: {
            default: null,
            parseHTML: (element) => element.style.fontWeight || null,
            renderHTML: ({ fontWeight }) =>
              fontWeight
                ? {
                    style: `font-weight: ${fontWeight}`,
                  }
                : {},
          },
          numberTemplate: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute('data-number-template') || null,
            renderHTML: ({ numberTemplate }) =>
              numberTemplate
                ? {
                    'data-number-template': numberTemplate,
                  }
                : {},
          },
        },
      },
    ]
  },

  onCreate() {
    try {
      const savedProfiles = typeof localStorage !== 'undefined' ? localStorage.getItem('umo-editor:profiles') : null
      if (savedProfiles) {
        const parsed = JSON.parse(savedProfiles)
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.storage.profiles = parsed
        }
      }
    } catch {}
    setTimeout(() => {
      if (!this.editor.isDestroyed) {
        this.editor.commands.syncDocumentReferences()
      }
    }, 0)
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('documentReferences'),
        appendTransaction: (transactions, oldState, newState) => {
          if (transactions.some((tr) => tr.getMeta(SYNC_META))) {
            return null
          }
          if (!transactions.some((transaction) => transaction.docChanged)) {
            return null
          }
          return createSyncTransaction(newState, this.storage)
        },
        props: {
          decorations: (state) => {
            const decorations = []
            state.doc.descendants((node, pos) => {
              if (!['heading', 'paragraph', 'table', 'image'].includes(node.type.name)) {
                return
              }
              const displayLabel = node.attrs.referenceLabel
              if (!displayLabel) {
                return
              }
              const {firstChild} = node
              const marks = firstChild?.marks || []
              const markKey = marks
                .map((m) => m.type.name + JSON.stringify(m.attrs))
                .join('-')

              decorations.push(
                Decoration.widget(
                  pos + 1,
                  () => {
                    const number = document.createElement('span')
                    const hasNewline = displayLabel.includes('\n')
                    const lines = displayLabel.split('\n')

                    if (hasNewline) {
                      number.className =
                        'umo-heading-number umo-heading-number-block'
                      number.style.display = 'block'
                      number.style.width = '100%'
                      number.style.marginBottom = '0'
                      number.style.lineHeight = 'inherit'
                    } else {
                      number.className = 'umo-heading-number'
                    }

                    number.contentEditable = 'false'

                    if (!hasNewline) {
                      number.textContent = displayLabel
                    } else {
                      number.textContent = ''
                      lines.forEach((lineText, idx) => {
                        if (idx > 0) {
                          number.appendChild(document.createElement('br'))
                        }
                        if (lineText) {
                          const lineSpan = document.createElement('span')
                          lineSpan.textContent = lineText
                          number.appendChild(lineSpan)
                        }
                      })
                    }

                    for (const mark of marks) {
                      if (mark.type.name === 'textStyle') {
                        if (mark.attrs.fontFamily) {
                          number.style.fontFamily = mark.attrs.fontFamily
                        }
                        if (mark.attrs.fontSize) {
                          number.style.fontSize = mark.attrs.fontSize
                        }
                        if (mark.attrs.color) {
                          number.style.color = mark.attrs.color
                        }
                        if (mark.attrs.lineHeight) {
                          number.style.lineHeight = mark.attrs.lineHeight
                        }
                      }
                      if (mark.type.name === 'bold') {
                        number.style.fontWeight = 'bold'
                      }
                      if (mark.type.name === 'italic') {
                        number.style.fontStyle = 'italic'
                      }
                    }

                    return number
                  },
                  {
                    key: `heading-number-${node.attrs.referenceId}-${node.attrs.numberingProfileId || ''}-${displayLabel}-${markKey}`,
                    side: -1,
                  },
                ),
              )
            })
            return DecorationSet.create(state.doc, decorations)
          },
          handleClickOn: (view, pos, node, nodePos, event) => {
            if (node.type.name !== 'crossReference') {
              return false
            }
            event.preventDefault()
            const { selection } = view.state
            if (
              selection instanceof NodeSelection &&
              selection.from === nodePos
            ) {
              return focusTargetElement(
                this.editor,
                node.attrs.targetId,
                node.attrs.targetType,
              )
            }
            this.editor.chain().setNodeSelection(nodePos).run()
            return true
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      getNumberingProfiles:
        (callback) =>
        () => {
          callback?.(this.storage.profiles)
          return true
        },
      addNumberingProfile:
        (profile) =>
        ({ state, dispatch }) => {
          const newProfile = {
            id: profile.id || `profile-${shortId(8)}`,
            name: profile.name || 'New Profile',
            enabled: profile.enabled !== false,
            style: profile.style || 'numeric',
            template: profile.template || '{number}',
            targetType: profile.targetType || 'heading',
            level: profile.level || 1,
            fontSize: profile.fontSize,
            fontWeight: profile.fontWeight,
            lineHeight: profile.lineHeight,
            marginBottom: profile.marginBottom,
            fontFamily: profile.fontFamily,
          }
          this.storage.profiles = [...this.storage.profiles, newProfile]
          try {
            localStorage.setItem('umo-editor:profiles', JSON.stringify(this.storage.profiles))
          } catch {}
          const tr = createSyncTransaction(state, this.storage)
          if (tr) dispatch?.(tr)
          return true
        },
      updateNumberingProfile:
        (id, updates) =>
        ({ state, dispatch }) => {
          let updatedProfile = null
          this.storage.profiles = this.storage.profiles.map((p) => {
            if (p.id === id) {
              updatedProfile = { ...p, ...updates }
              return updatedProfile
            }
            return p
          })
          try {
            localStorage.setItem('umo-editor:profiles', JSON.stringify(this.storage.profiles))
          } catch {}

          const { tr } = state
          if (updatedProfile) {
            state.doc.descendants((node, pos) => {
              if (node.attrs?.numberingProfileId === id) {
                const nextAttrs = { ...node.attrs }
                if (updatedProfile.template !== undefined) {
                  nextAttrs.numberTemplate = updatedProfile.template
                }
                if (updatedProfile.style !== undefined) {
                  nextAttrs.numberStyle = updatedProfile.style
                }
                if (
                  updatedProfile.lineHeight !== undefined &&
                  updatedProfile.lineHeight !== ''
                ) {
                  nextAttrs.lineHeight = updatedProfile.lineHeight
                }
                if (
                  updatedProfile.fontSize !== undefined &&
                  updatedProfile.fontSize !== ''
                ) {
                  nextAttrs.fontSize = updatedProfile.fontSize
                }
                if (
                  updatedProfile.fontWeight !== undefined &&
                  updatedProfile.fontWeight !== ''
                ) {
                  nextAttrs.fontWeight = updatedProfile.fontWeight
                }
                if (
                  updatedProfile.marginBottom !== undefined &&
                  updatedProfile.marginBottom !== ''
                ) {
                  nextAttrs.margin = {
                    ...(node.attrs.margin || {}),
                    bottom: updatedProfile.marginBottom,
                  }
                }
                tr.setNodeMarkup(pos, undefined, nextAttrs)

                if (updatedProfile.fontSize || updatedProfile.fontFamily) {
                  const textStyleType = state.schema.marks.textStyle
                  if (textStyleType && node.content) {
                    node.content.forEach((child, offset) => {
                      if (child.isText) {
                        const from = pos + 1 + offset
                        const to = from + child.nodeSize
                        const attrs = {
                          ...(child.marks.find((m) => m.type === textStyleType)
                            ?.attrs || {}),
                        }
                        if (updatedProfile.fontSize)
                          attrs.fontSize = updatedProfile.fontSize
                        if (updatedProfile.fontFamily)
                          attrs.fontFamily = updatedProfile.fontFamily
                        tr.addMark(from, to, textStyleType.create(attrs))
                      }
                    })
                  }
                }
              }
            })
          }
          const planTr = createSyncTransaction(state, this.storage)
          if (planTr) {
            dispatch?.(planTr)
          } else {
            tr.setMeta(SYNC_META, true)
            tr.setMeta('addToHistory', false)
            dispatch?.(tr)
          }
          return true
        },
      deleteNumberingProfile:
        (id) =>
        ({ state, dispatch }) => {
          this.storage.profiles = this.storage.profiles.filter(
            (p) => p.id !== id,
          )
          try {
            localStorage.setItem('umo-editor:profiles', JSON.stringify(this.storage.profiles))
          } catch {}
          const tr = createSyncTransaction(state, this.storage)
          if (tr) dispatch?.(tr)
          return true
        },
      applyNumberingProfile:
        (profileId) =>
        ({ state, dispatch }) => {
          const { selection } = state
          const { $from } = selection
          let targetPos = null
          let targetNode = null
          for (let { depth } = $from; depth >= 0; depth -= 1) {
            const node = $from.node(depth)
            if (['heading', 'image', 'table', 'paragraph'].includes(node.type.name)) {
              targetPos = $from.before(depth)
              targetNode = node
              break
            }
          }
          if (targetPos === null) {
            return false
          }
          const { tr } = state
          const profile = this.storage.profiles.find((p) => p.id === profileId)
          const nextAttrs = {
            ...targetNode.attrs,
            numberingProfileId: profileId,
          }
          if (profile) {
            if (profile.template !== undefined && profile.template !== '') {
              nextAttrs.numberTemplate = profile.template
            }
            if (profile.style !== undefined && profile.style !== '') {
              nextAttrs.numberStyle = profile.style
            }
            if (profile.lineHeight !== undefined && profile.lineHeight !== '') {
              nextAttrs.lineHeight = profile.lineHeight
            }
            if (profile.fontSize !== undefined && profile.fontSize !== '') {
              nextAttrs.fontSize = profile.fontSize
            }
            if (profile.fontWeight !== undefined && profile.fontWeight !== '') {
              nextAttrs.fontWeight = profile.fontWeight
            } else if (profile.targetType === 'paragraph') {
              nextAttrs.fontWeight = 'normal'
            }
            if (
              profile.marginBottom !== undefined &&
              profile.marginBottom !== ''
            ) {
              nextAttrs.margin = {
                ...(targetNode.attrs.margin || {}),
                bottom: profile.marginBottom,
              }
            }
          }
          tr.setNodeMarkup(targetPos, undefined, nextAttrs)

          if (
            profile &&
            (profile.targetType === 'paragraph' || profile.fontWeight === 'normal')
          ) {
            const boldMarkType = state.schema.marks.bold
            if (boldMarkType && targetNode.nodeSize > 2) {
              tr.removeMark(
                targetPos + 1,
                targetPos + targetNode.nodeSize - 1,
                boldMarkType,
              )
            }
          }

          if (profile && (profile.fontSize || profile.fontFamily)) {
            const textStyleType = state.schema.marks.textStyle
            if (textStyleType && targetNode.content) {
              targetNode.content.forEach((child, offset) => {
                if (child.isText) {
                  const from = targetPos + 1 + offset
                  const to = from + child.nodeSize
                  const attrs = {
                    ...(child.marks.find((m) => m.type === textStyleType)
                      ?.attrs || {}),
                  }
                  if (profile.fontSize) attrs.fontSize = profile.fontSize
                  if (profile.fontFamily) attrs.fontFamily = profile.fontFamily
                  tr.addMark(from, to, textStyleType.create(attrs))
                }
              })
            }
          }

          const { targets, updates } = createPlan(tr.doc, this.storage)
          applyTargetUpdates(tr, updates)
          applyCrossReferenceUpdates(tr, targets)
          this.storage.targets = targets
          tr.setMeta(SYNC_META, true)
          tr.setMeta('addToHistory', false)
          dispatch?.(tr)
          return true
        },
      toggleAutomaticNumbering:
        (enabled) =>
        ({ state, dispatch }) => {
          const nextState =
            typeof enabled === 'boolean'
              ? enabled
              : !this.storage.numberingEnabled
          this.storage.numberingEnabled = nextState
          const tr = createSyncTransaction(state, this.storage)
          if (tr) {
            dispatch?.(tr)
          } else {
            const emptyTr = state.tr.setMeta(SYNC_META, true)
            emptyTr.setMeta('addToHistory', false)
            dispatch?.(emptyTr)
          }
          return true
        },
      setNumberingConfig:
        (config = {}) =>
        ({ state, dispatch }) => {
          if (typeof config.enabled === 'boolean') {
            this.storage.numberingEnabled = config.enabled
          }
          if (config.styles) {
            this.storage.styles = { ...this.storage.styles, ...config.styles }
          }
          if (config.templates) {
            this.storage.templates = {
              ...this.storage.templates,
              ...config.templates,
            }
          }
          if (Array.isArray(config.profiles)) {
            this.storage.profiles = config.profiles
          }
          const tr = createSyncTransaction(state, this.storage)
          if (tr) {
            dispatch?.(tr)
          } else {
            const emptyTr = state.tr.setMeta(SYNC_META, true)
            emptyTr.setMeta('addToHistory', false)
            dispatch?.(emptyTr)
          }
          return true
        },
      getNumberingConfig:
        (callback) =>
        () => {
          callback?.({
            enabled: this.storage.numberingEnabled !== false,
            styles: { ...this.storage.styles },
            templates: { ...this.storage.templates },
            profiles: [...this.storage.profiles],
          })
          return true
        },
      syncDocumentReferences:
        () =>
        ({ state, dispatch }) => {
          const tr = createSyncTransaction(state, this.storage)
          if (!tr) {
            return false
          }
          dispatch?.(tr)
          return true
        },
      getReferenceTargets:
        (callback) =>
        ({ state }) => {
          const { targets } = createPlan(state.doc, this.storage)
          this.storage.targets = targets
          callback?.(
            targets.map((target) => ({
              ...target,
              optionLabel: getReferenceTargetOptionLabel(target),
            })),
          )
          return true
        },
      insertCrossReference:
        ({ targetId, displayMode = 'label' }) =>
        ({ commands, state }) => {
          const { targets } = createPlan(state.doc, this.storage)
          const target = targets.find((item) => item.targetId === targetId)
          if (!target) {
            return false
          }
          return commands.insertContent({
            type: 'crossReference',
            attrs: {
              targetId: target.targetId,
              targetType: target.targetType,
              displayMode,
              targetNumber: target.number,
              targetText: target.title,
              referenceText: getCrossReferenceText(
                target,
                displayMode,
                getLabels(),
              ),
              missing: false,
            },
          })
        },
      setReferenceCaption:
        (caption) =>
        ({ state, dispatch }) => {
          const target = findActiveTarget(state)
          if (!target) {
            return false
          }
          const normalizedCaption = normalizeText(caption)
          const { tr } = state
          if (target.targetType === 'table') {
            tr.setNodeMarkup(target.pos, undefined, {
              ...target.node.attrs,
              caption: normalizedCaption,
            })
          } else {
            const content = normalizedCaption
              ? Fragment.from(state.schema.text(normalizedCaption))
              : Fragment.empty
            const image = target.node.type.create(
              {
                ...target.node.attrs,
                showTitle: true,
              },
              content,
              target.node.marks,
            )
            tr.replaceWith(target.pos, target.pos + target.node.nodeSize, image)
          }
          dispatch?.(tr)
          return true
        },
      getActiveReferenceCaption:
        (callback) =>
        ({ state }) => {
          const target = findActiveTarget(state)
          callback?.(
            target
              ? {
                  targetType: target.targetType,
                  caption: getTargetCaption(target),
                }
              : null,
          )
          return !!target
        },
      focusReferenceTarget:
        ({ targetId, targetType }) =>
        () =>
          focusTargetElement(this.editor, targetId, targetType),
    }
  },
})
