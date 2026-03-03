import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const serverIndexPath = path.join(rootDir, 'server', 'index.js')
const source = fs.readFileSync(serverIndexPath, 'utf8')

const start = source.indexOf('const VUE_VITE_JS_TEMPLATE_DIR =')
const end = source.indexOf('const PROJECT_TEMPLATES = {')
if (start === -1 || end === -1 || end <= start) {
  throw new Error('Unable to locate Vue JS mirror builder in server/index.js')
}

const snippet = source.slice(start, end)
const sandbox = {
  fs,
  path,
  TEMPLATE_ROOT: path.join(rootDir, 'server', 'templates'),
  inferMimeFromPath: (filePath = '') => {
    const ext = String(filePath).toLowerCase().split('.').pop() || ''
    const table = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      bmp: 'image/bmp',
      avif: 'image/avif',
    }
    return table[ext] || null
  },
}

vm.createContext(sandbox)
vm.runInContext(`${snippet}\n globalThis.__vueMirror = { buildVueViteJsFiles };`, sandbox)

const { buildVueViteJsFiles } = sandbox.__vueMirror || {}
if (typeof buildVueViteJsFiles !== 'function') {
  throw new Error('Vue mirror builder not available')
}

const files = buildVueViteJsFiles({ name: 'mirror-check-vue' })
const paths = new Set(files.map((f) => f.path))

const required = [
  '.vscode/extensions.json',
  '.vscode/settings.json',
  'src/router/index.js',
  'src/stores/counter.js',
  'src/views/HomeView.vue',
  'src/views/AboutView.vue',
  '.oxlintrc.json',
  'eslint.config.js',
  '.prettierrc.json',
  'public/favicon.ico',
]

for (const requiredPath of required) {
  if (!paths.has(requiredPath)) {
    throw new Error(`Missing expected Vue scaffold file: ${requiredPath}`)
  }
}

const packageFile = files.find((f) => f.path === 'package.json')
if (!packageFile?.content || !String(packageFile.content).includes('"name": "mirror-check-vue"')) {
  throw new Error('package.json name was not adjusted to project name')
}

const readme = files.find((f) => f.path === 'README.md')
if (!readme?.content || !String(readme.content).startsWith('# mirror-check-vue')) {
  throw new Error('README title was not adjusted to project name')
}

console.log(JSON.stringify({ ok: true, fileCount: files.length }, null, 2))
