import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const serverIndexPath = path.join(rootDir, 'server', 'index.js')
const source = fs.readFileSync(serverIndexPath, 'utf8')

const startMarker = 'const NODE_EXPRESS_VARIANTS = ['
const endMarker = 'const PROJECT_TEMPLATES = {'
const start = source.indexOf(startMarker)
const end = source.indexOf(endMarker)

if (start === -1 || end === -1 || end <= start) {
  throw new Error('Unable to locate Node+Express variant builder in server/index.js')
}

const snippet = source.slice(start, end)
const sandbox = {}
vm.createContext(sandbox)
vm.runInContext(
  `${snippet}\n globalThis.__nodeExpress = { NODE_EXPRESS_VARIANTS, buildNodeExpressVariantFiles };`,
  sandbox,
)

const { NODE_EXPRESS_VARIANTS, buildNodeExpressVariantFiles } = sandbox.__nodeExpress || {}
if (!Array.isArray(NODE_EXPRESS_VARIANTS) || typeof buildNodeExpressVariantFiles !== 'function') {
  throw new Error('Node+Express variant exports not available from snippet evaluation')
}

const runId = String(Date.now())
const outRoot = path.join(rootDir, '.variant-verify', 'node-express', runId)
fs.mkdirSync(outRoot, { recursive: true })

const projectName = 'variant-check-node-express'
const variants = ['javascript', 'typescript']

const writeVariant = (variantId) => {
  const dir = path.join(outRoot, variantId)
  fs.mkdirSync(dir, { recursive: true })

  const files = buildNodeExpressVariantFiles({ name: projectName, variantId })
  for (const file of files) {
    const relativePath = String(file.path || '')
    if (!relativePath) continue
    const absPath = path.join(dir, ...relativePath.split('/'))
    fs.mkdirSync(path.dirname(absPath), { recursive: true })
    fs.writeFileSync(absPath, String(file.content || ''), 'utf8')
  }

  return { dir, files }
}

const run = (cwd, command, timeout = 120000, extraEnv = {}) => {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, ...extraEnv },
  })

  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

const summary = {}
for (const variantId of variants) {
  const { dir, files } = writeVariant(variantId)
  const devPort = variantId === 'javascript' ? '3101' : '3102'

  const install = run(dir, 'npm install', 180000)
  const dev = run(dir, 'npm run dev', 20000, { PORT: devPort })

  const output = `${dev.stdout}\n${dev.stderr}`
  const serverStarted = new RegExp(`Server running on http:\\/\\/localhost:${devPort}`).test(output)

  summary[variantId] = {
    fileCount: files.length,
    hasTsconfig: fs.existsSync(path.join(dir, 'tsconfig.json')),
    hasNodemon: fs.existsSync(path.join(dir, 'nodemon.json')),
    hasJsServer: fs.existsSync(path.join(dir, 'src', 'server.js')),
    hasTsServer: fs.existsSync(path.join(dir, 'src', 'server.ts')),
    installStatus: install.status,
    devStatus: dev.status,
    serverStarted,
  }

  if (install.status !== 0) {
    console.error(`Install failed for ${variantId}`)
    console.error(install.stdout)
    console.error(install.stderr)
    process.exit(1)
  }

  if (!serverStarted) {
    console.error(`Dev server did not start for ${variantId}`)
    console.error(dev.stdout)
    console.error(dev.stderr)
    process.exit(1)
  }
}

const js = summary.javascript
const ts = summary.typescript
const variantDifferencesValid =
  js.hasNodemon &&
  js.hasJsServer &&
  !js.hasTsconfig &&
  !js.hasTsServer &&
  ts.hasTsconfig &&
  ts.hasTsServer

if (!variantDifferencesValid) {
  console.error('Variant differences are not correct:', summary)
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, summary }, null, 2))
