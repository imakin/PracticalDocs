import { BulletList } from '@tiptap/extension-list'

export default BulletList.extend({
  // A list may hold a list directly, not only through an item.
  //
  // Indenting means nesting, and nesting used to need an item above to nest under - so the first
  // item of a list could not be indented at all, and a writer could not put `a.` and `b.` under a
  // `3.` that was the start of its own list. There is nothing to nest under there, and inventing an
  // empty numbered item to be the parent would put a number on the page that nobody typed.
  //
  // A list inside a list says the same thing without inventing anything: level 1 sits under level 0
  // even when level 0 holds no item of its own. It is also how Word writes it.
  //
  // `adr/0014-a-list-may-hold-a-list.md`.
  content: '(listItem | orderedList | bulletList)*',
  addAttributes() {
    return {
      ...this.parent?.(),
      listType: {
        default: 'disc',
        parseHTML: (element) =>
          element.style.getPropertyValue('list-style-type') || 'disc',
        renderHTML: ({ listType }) => {
          return {
            style: `list-style-type: ${listType}`,
            'data-type': listType,
          }
        },
      },
    }
  },
})
