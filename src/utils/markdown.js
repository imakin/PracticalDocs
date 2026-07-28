import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
})

export const renderMarkdown = (content) =>
  markdown.render(String(content || ''))
