<template>
  <div class="examples">
    <div class="box">
      <umo-editor ref="editorRef" v-bind="options"></umo-editor>
    </div>
    <!-- <div class="box">
      <umo-editor editor-key="testaaa" :toolbar="{ defaultMode: 'classic' }" />
    </div> -->
  </div>
</template>

<script setup>
import {
  collectAssets,
  findUnresolvedMedia,
  registerUpload,
} from '@/utils/document-assets'
import { shortId } from '@/utils/short-id'

const editorRef = $ref(null)
const remoteMentionUsers = [
  {
    id: 'remote-alice',
    label: 'Alice Chen',
    bio: '远程目录用户',
    color: 'var(--umo-primary-color)',
  },
  {
    id: 'remote-bob',
    label: 'Bob Li',
    bio: '远程目录用户',
    color: 'var(--umo-primary-color)',
  },
  {
    id: 'remote-charlie',
    label: 'Charlie Wang',
    bio: '远程目录用户',
    color: 'var(--umo-primary-color)',
  },
  {
    id: 'remote-dora',
    label: 'Dora Xu',
    bio: '远程目录用户',
    color: 'var(--umo-primary-color)',
  },
]
const templates = [
  {
    title: '工作任务',
    description: '工作任务模板',
    content:
      '<h1>工作任务</h1><h3>任务名称：</h3><p>[任务的简短描述]</p><h3>负责人：</h3><p>[执行任务的个人姓名]</p><h3>截止日期：</h3><p>[任务需要完成的日期]</p><h3>任务详情：</h3><ol><li>[任务步骤1]</li><li>[任务步骤2]</li><li>[任务步骤3]...</li></ol><h3>目标：</h3><p>[任务需要达成的具体目标或结果]</p><h3>备注：</h3><p>[任何额外信息或注意事项]</p>',
  },
  {
    title: '工作周报',
    description: '工作周报模板',
    content:
      '<h1>工作周报</h1><h2>本周工作总结</h2><hr /><h3>已完成工作：</h3><ul><li>[任务1名称]：[简要描述任务内容及完成情况]</li><li>[任务2名称]：[简要描述任务内容及完成情况]</li><li>...</li></ul><h3>进行中工作：</h3><ul><li>[任务1名称]：[简要描述任务当前进度和下一步计划]</li><li>[任务2名称]：[简要描述任务当前进度和下一步计划]</li><li>...</li></ul><h3>问题与挑战：</h3><ul><li>[问题1]：[描述遇到的问题及当前解决方案或需要的支持]</li><li>[问题2]：[描述遇到的问题及当前解决方案或需要的支持]</li><li>...</li></ul><hr /><h2>下周工作计划</h2><h3>计划开展工作：</h3><ul><li>[任务1名称]：[简要描述下周计划开始的任务内容]</li><li>[任务2名称]：[简要描述下周计划开始的任务内容]</li><li>...</li></ul><h3>需要支持与资源：</h3><ul><li>[资源1]：[描述需要的资源或支持]</li><li>[资源2]：[描述需要的资源或支持]</li><li>...</li></ul>',
  },
]
const options = $ref({
  locale: 'en-US',
  toolbar: {
    // defaultMode: 'classic',
    // menus: ['base'],
  },
  document: {
    title: 'file-identifier',
    content: (() => {
      const cachedJson = localStorage.getItem('document.json')
      if (cachedJson) {
        try {
          return JSON.parse(cachedJson)
        } catch {}
      }
      return localStorage.getItem('document.content') || ''
    })(),
    // structure: 'heading block*',
  },
  page: {
    layouts: ['page', 'web'],
    showBookmark: true,
  },
  templates,
  cdnUrl: 'https://cdn.umodoc.com',
  shareUrl: 'https://www.umodoc.com',
  file: {
    // allowedMimeTypes: [
    //   'application/pdf',
    //   'image/svg+xml',
    //   'video/mp4',
    //   'audio/*',
    // ],
  },
  user: {
    id: 'umoeditor',
    label: 'Umo Editor',
    avatar: 'https://tdesign.gtimg.com/site/avatar.jpg',
  },
  users: [
    {
      id: 'umodoc',
      label: 'Umo Team',
      bio: '核心开发者',
      avatar: 'https://s1.umodoc.com/images/favicon.png',
      color: 'var(--umo-primary-color)',
    },
    {
      id: 'china-wangxu',
      label: 'china-wangxu',
      bio: '重要贡献者',
      color: 'var(--umo-primary-color)',
    },
    {
      id: 'Cassielxd',
      label: 'Cassielxd',
      bio: '重要贡献者',
      color: 'var(--umo-primary-color)',
    },
    { id: 'Goldziher', label: "Na'aman Hirschfeld" },
    { id: 'SerRashin', label: 'SerRashin' },
    { id: 'ChenErik', label: 'ChenErik' },
    { id: 'china-wangxu', label: 'china-wangxu' },
    { id: 'Sherman Xu', label: 'xuzhenjun130' },
    { id: 'testuser', label: '测试用户' },
  ],
  async onMentionSearch(query) {
    await new Promise((resolve) => setTimeout(resolve, 800))
    return remoteMentionUsers.filter((user) =>
      user.label.toLowerCase().includes(query.toLowerCase()),
    )
  },
  // https://dev.umodoc.com/cn/docs/options/extensions#disableextensions
  disableExtensions: [],
  async onSave(content, page, document) {
    if (content.html) localStorage.setItem('document.content', content.html)
    if (content.json) {
      try {
        localStorage.setItem('document.json', JSON.stringify(content.json))
      } catch {}
    }
    if (content.snapshot) {
      try {
        localStorage.setItem('document.snapshot', JSON.stringify(content.snapshot))
      } catch {}
    }
    if (content.profiles && content.profiles.length > 0) {
      try {
        localStorage.setItem('umo-editor:profiles', JSON.stringify(content.profiles))
      } catch {}
    }

    const saveTarget = localStorage.getItem('umo-editor:save-target') || 'practical-umodoc-server'
    const serverUrl = localStorage.getItem('umo-editor:server-url') || 'http://localhost:3001/api/documents/save'

    if (saveTarget === 'practical-umodoc-server') {
      try {
        let rawTitle = (document?.title && String(document.title).trim()) ? String(document.title).trim() : (content?.snapshot?.document?.title || 'file-identifier')
        if (rawTitle === '测试文档') rawTitle = 'file-identifier'
        let baseName = rawTitle
        if (baseName.toLowerCase().endsWith('.enc')) baseName = baseName.slice(0, -4)
        if (baseName.toLowerCase().endsWith('.json')) baseName = baseName.slice(0, -5)
        if (baseName.toLowerCase().endsWith('.umodoc')) baseName = baseName.slice(0, -7)

        const cleanFilename = baseName.replaceAll(/[^a-zA-Z0-9_\-.]/g, '_').replaceAll(/_+/g, '_').replaceAll(/^_+|_+$/g, '')
        const filename = cleanFilename || 'file-identifier'
        const title = rawTitle

        // Media sources are folded back to portable markers, and the bytes this session uploaded
        // travel with them. Anything the archive already holds is named by hash only.
        const packed = await collectAssets(content)
        const stranded = findUnresolvedMedia(packed)
        if (stranded.length > 0) {
          return {
            status: 'error',
            message: `${stranded.length} media file(s) could not be prepared for saving. Re-insert them and try again.`,
          }
        }

        const response = await fetch(serverUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: filename,
            filename,
            title,
            html: packed.html,
            json: packed.json,
            snapshot: packed.snapshot,
            profiles: content.profiles || [],
            pageSettings: page,
            assets: packed.assets,
          }),
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const resData = await response.json()
        if (Array.isArray(resData.missingAssets) && resData.missingAssets.length > 0) {
          return {
            status: 'error',
            message: `Saved, but ${resData.missingAssets.length} image(s) could not be stored. Re-insert them and save again.`,
          }
        }
        if (resData.success === false) {
          return {
            status: 'error',
            message: resData.message || 'Failed to save document to server.',
          }
        }

        return resData.message || `Document '${filename}' encrypted & saved to practical-umodoc-server successfully!`
      } catch (error) {
        return {
          status: 'error',
          message: `Failed to save to server (${serverUrl}): ${error.message}`,
        }
      }
    } else if (saveTarget === 'google-drive') {
      return {
        status: 'error',
        message: 'Google Drive integration is coming soon',
      }
    } else {
      return 'Document saved to Local Storage successfully!'
    }
  },
  async onFileUpload(file) {
    if (!file) {
      throw new Error('No file to upload.')
    }
    // The bytes are kept so the next save can put them in the document archive. Returning a bare
    // object URL, as this did before, meant the image lived only in this tab and was lost the moment
    // it closed - the document recorded the name and the size, and not one byte of the image.
    const registered = await registerUpload(file)
    return {
      id: shortId(),
      url: registered.url,
      name: file.name,
      type: file.type,
      size: file.size,
    }
  },
  onFileDelete(id, url, type) {
    console.log(id, url, type)
  },
})
</script>

<style>
html,
body {
  padding: 0;
  margin: 0;
}
.examples {
  margin: 20px;
  display: flex;
  height: calc(100vh - 40px);
}
.box {
  border: solid 1px #ddd;
  box-sizing: border-box;
  position: relative;
  width: 100%;
  height: 100%;
}

html,
body {
  height: 100vh;
  overflow: hidden;
}
</style>
