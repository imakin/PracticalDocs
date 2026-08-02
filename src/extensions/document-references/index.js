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
const TARGET_NODE_TYPES = new Set(['heading', 'image', 'table'])

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
          id: 'profile-h1',
          name: 'Heading 1 (BAB)',
          enabled: true,
          style: 'roman-upper',
          template: 'BAB {number}',
          targetType: 'heading',
          level: 1,
        },
        {
          id: 'profile-h2',
          name: 'Heading 2',
          enabled: true,
          style: 'numeric',
          template: '{number}',
          targetType: 'heading',
          level: 2,
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
              if (node.type.name !== 'heading') {
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
                    number.className = 'umo-heading-number'
                    number.contentEditable = 'false'
                    number.textContent = displayLabel

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
          }
          this.storage.profiles = [...this.storage.profiles, newProfile]
          const tr = createSyncTransaction(state, this.storage)
          if (tr) dispatch?.(tr)
          return true
        },
      updateNumberingProfile:
        (id, updates) =>
        ({ state, dispatch }) => {
          this.storage.profiles = this.storage.profiles.map((p) =>
            p.id === id ? { ...p, ...updates } : p,
          )
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
      deleteNumberingProfile:
        (id) =>
        ({ state, dispatch }) => {
          this.storage.profiles = this.storage.profiles.filter(
            (p) => p.id !== id,
          )
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
          for (let {depth} = $from; depth >= 0; depth -= 1) {
            const node = $from.node(depth)
            if (['heading', 'image', 'table'].includes(node.type.name)) {
              targetPos = $from.before(depth)
              targetNode = node
              break
            }
          }
          if (targetPos === null) {
            return false
          }
          const { tr } = state
          tr.setNodeMarkup(targetPos, undefined, {
            ...targetNode.attrs,
            numberingProfileId: profileId,
          })
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
