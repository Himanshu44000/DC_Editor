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
  throw new Error('Unable to locate Vue Vite builder block in server/index.js')
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
vm.runInContext(
  `${snippet}\n globalThis.__vue = { buildVueViteFiles, VUE_VITE_VARIANTS };`,
  sandbox,
)

const { buildVueViteFiles, VUE_VITE_VARIANTS } = sandbox.__vue || {}
if (typeof buildVueViteFiles !== 'function' || !Array.isArray(VUE_VITE_VARIANTS)) {
  throw new Error('Vue Vite variants helpers unavailable')
}

const expectPaths = {
  javascript: [
    'jsconfig.json',
    'eslint.config.js',
    'vite.config.js',
    'src/main.js',
    'src/router/index.js',
    'src/stores/counter.js',
  ],
  typescript: [
    'env.d.ts',
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.node.json',
    'eslint.config.ts',
    'vite.config.ts',
    'src/main.ts',
    'src/router/index.ts',
    'src/stores/counter.ts',
  ],
}

const result = {}
for (const variant of VUE_VITE_VARIANTS) {
  const files = buildVueViteFiles({ name: 'mirror-check-vue', variantId: variant.id })
  const paths = new Set(files.map((file) => file.path))

  for (const requiredPath of expectPaths[variant.id] || []) {
    if (!paths.has(requiredPath)) {
      throw new Error(`Missing ${requiredPath} for variant ${variant.id}`)
    }
  }

  if (!paths.has('public/favicon.ico')) {
    throw new Error(`Missing public/favicon.ico for variant ${variant.id}`)
  }

  const packageFile = files.find((file) => file.path === 'package.json')
  if (!packageFile || !String(packageFile.content).includes('"name": "mirror-check-vue"')) {
    throw new Error(`package.json name not updated for variant ${variant.id}`)
  }

  const readme = files.find((file) => file.path === 'README.md')
  if (!readme || !String(readme.content).startsWith('# mirror-check-vue')) {
    throw new Error(`README title not updated for variant ${variant.id}`)
  }

  result[variant.id] = {
    fileCount: files.length,
    hasFaviconBinary: files.some((file) => file.path === 'public/favicon.ico' && !!file.binaryDataUrl),
  }
}

console.log(JSON.stringify({ ok: true, result }, null, 2))
