<template>
  <div class="examples">
    <div class="box">
      <practical-docs ref="editorRef" v-bind="options"></practical-docs>
    </div>
    <!-- <div class="box">
      <practical-docs editor-key="testaaa" :toolbar="{ defaultMode: 'classic' }" />
    </div> -->
  </div>
</template>

<script setup>
const editorRef = $ref(null)
const remoteMentionUsers = [
  {
    id: 'remote-alice',
    label: 'Alice Chen',
    bio: '远程目录用户',
    color: 'var(--pdoc-primary-color)',
  },
  {
    id: 'remote-bob',
    label: 'Bob Li',
    bio: '远程目录用户',
    color: 'var(--pdoc-primary-color)',
  },
  {
    id: 'remote-charlie',
    label: 'Charlie Wang',
    bio: '远程目录用户',
    color: 'var(--pdoc-primary-color)',
  },
  {
    id: 'remote-dora',
    label: 'Dora Xu',
    bio: '远程目录用户',
    color: 'var(--pdoc-primary-color)',
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
    // Deliberately empty on start. Restoring the last document from localStorage made every reload
    // begin from whatever happened to be cached, which hid bugs behind state nobody could describe
    // and made "I cannot reproduce it" the usual answer. Opening a document is now always an
    // explicit act, through Buka / Load. The cache is still written on save and is still readable
    // through that menu.
    content: '',
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
    id: 'practicaldocs',
    label: 'PracticalDocs',
    avatar: 'https://tdesign.gtimg.com/site/avatar.jpg',
  },
  users: [
    {
      id: 'umodoc',
      label: 'PracticalDocs',
      bio: '核心开发者',
      avatar: 'https://s1.umodoc.com/images/favicon.png',
      color: 'var(--pdoc-primary-color)',
    },
    {
      id: 'china-wangxu',
      label: 'china-wangxu',
      bio: '重要贡献者',
      color: 'var(--pdoc-primary-color)',
    },
    {
      id: 'Cassielxd',
      label: 'Cassielxd',
      bio: '重要贡献者',
      color: 'var(--pdoc-primary-color)',
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
  // No `onSave` and no `onFileUpload` here. Saving to the practicaldocs-server and keeping uploaded
  // bytes are what the editor does by default now, so this demo host would only be repeating it -
  // and a copy here is a copy that can drift from the one every other host gets.
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
