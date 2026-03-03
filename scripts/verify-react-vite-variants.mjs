import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const fail = (message) => {
  console.error(`❌ ${message}`)
  process.exit(1)
}

const root = process.cwd()
const serverPath = path.join(root, 'server', 'index.js')
const serverContent = fs.readFileSync(serverPath, 'utf8')

const start = serverContent.indexOf('const REACT_VITE_VARIANTS = [')
const end = serverContent.indexOf('const PROJECT_TEMPLATES = {')

if (start === -1 || end === -1 || end <= start) fail('Could not locate React Vite scaffold region in server/index.js')

const snippet = `${serverContent.slice(start, end)}\nthis.__exports = { REACT_VITE_VARIANTS, buildReactViteVariantFiles }`
const context = {}
vm.createContext(context)
vm.runInContext(snippet, context)

const { REACT_VITE_VARIANTS, buildReactViteVariantFiles } = context.__exports || {}
if (!Array.isArray(REACT_VITE_VARIANTS) || typeof buildReactViteVariantFiles !== 'function') fail('Failed to extract scaffold builders')

const variantIds = REACT_VITE_VARIANTS.map((variant) => variant.id)
const expectedVariantIds = [
  'typescript',
  'typescript-react-compiler',
  'typescript-swc',
  'javascript',
  'javascript-react-compiler',
  'javascript-swc',
]

if (JSON.stringify(variantIds) !== JSON.stringify(expectedVariantIds)) {
  fail(`Variant list mismatch.\nExpected: ${expectedVariantIds.join(', ')}\nReceived: ${variantIds.join(', ')}`)
}

const outRoot = path.join(root, '.variant-verify')
fs.rmSync(outRoot, { recursive: true, force: true })
fs.mkdirSync(outRoot, { recursive: true })

const assertChecks = (signature) => {
  const isTs = signature.variant.startsWith('typescript')
  const isSwc = signature.variant.endsWith('-swc')
  const isCompiler = signature.variant.includes('react-compiler')

  if (signature.hasPublicViteSvg) {
    fail(`${signature.variant}: should not generate public/vite.svg`)
  }
  if (!signature.hasPublicFavicon) {
    fail(`${signature.variant}: missing public/favicon.svg`)
  }
  if (!signature.hasAssetViteSvg) {
    fail(`${signature.variant}: missing src/assets/vite.svg`)
  }

  if (isTs) {
    if (!signature.hasTsconfig) fail(`${signature.variant}: missing tsconfig.json`)
    if (!signature.hasTypeScriptDep) fail(`${signature.variant}: missing typescript dependency`)
    if (signature.buildScript !== 'tsc -b && vite build') {
      fail(`${signature.variant}: unexpected build script (${signature.buildScript})`)
    }
  } else {
    if (signature.hasTsconfig) fail(`${signature.variant}: should not include tsconfig.json`)
    if (signature.hasTypeScriptDep) fail(`${signature.variant}: should not include typescript dependency`)
    if (signature.buildScript !== 'vite build') {
      fail(`${signature.variant}: unexpected build script (${signature.buildScript})`)
    }
  }

  if (isSwc) {
    if (!signature.vitePluginSwc) fail(`${signature.variant}: SWC plugin not configured in vite config`)
    if (!signature.hasSwcDep) fail(`${signature.variant}: missing @vitejs/plugin-react-swc dependency`)
    if (signature.hasBabelReactPlugin) fail(`${signature.variant}: should not include @vitejs/plugin-react dependency`)
  } else {
    if (signature.vitePluginSwc) fail(`${signature.variant}: should not use SWC plugin`)
    if (signature.hasSwcDep) fail(`${signature.variant}: should not include @vitejs/plugin-react-swc dependency`)
    if (!signature.hasBabelReactPlugin) fail(`${signature.variant}: missing @vitejs/plugin-react dependency`)
  }

  if (isCompiler) {
    if (!signature.viteCompilerEnabled) fail(`${signature.variant}: compiler plugin not configured in vite config`)
    if (!signature.hasCompilerDep) fail(`${signature.variant}: missing babel-plugin-react-compiler dependency`)
  } else {
    if (signature.viteCompilerEnabled) fail(`${signature.variant}: compiler plugin should not be enabled`)
    if (signature.hasCompilerDep) fail(`${signature.variant}: should not include babel-plugin-react-compiler dependency`)
  }
}

const signatures = []

for (const variant of REACT_VITE_VARIANTS) {
  const variantDir = path.join(outRoot, variant.id)
  fs.mkdirSync(variantDir, { recursive: true })

  const files = buildReactViteVariantFiles({ name: `verify-${variant.id}`, variantId: variant.id })
  const byPath = new Map(files.map((entry) => [entry.path, entry.content]))

  for (const file of files) {
    const outPath = path.join(variantDir, file.path)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, file.content, 'utf8')
  }

  const packageJson = JSON.parse(byPath.get('package.json') || '{}')
  const viteConfigPath = variant.id.startsWith('typescript') ? 'vite.config.ts' : 'vite.config.js'
  const viteConfig = byPath.get(viteConfigPath) || ''

  signatures.push({
    variant: variant.id,
    language: variant.defaultLanguage,
    buildScript: packageJson.scripts?.build || '',
    vitePluginSwc: viteConfig.includes("@vitejs/plugin-react-swc"),
    viteCompilerEnabled: viteConfig.includes('babel-plugin-react-compiler'),
    hasTsconfig: byPath.has('tsconfig.json'),
    hasTypeScriptDep: Boolean(packageJson.devDependencies?.typescript),
    hasCompilerDep: Boolean(packageJson.devDependencies?.['babel-plugin-react-compiler']),
    hasSwcDep: Boolean(packageJson.devDependencies?.['@vitejs/plugin-react-swc']),
    hasBabelReactPlugin: Boolean(packageJson.devDependencies?.['@vitejs/plugin-react']),
    hasAssetViteSvg: byPath.has('src/assets/vite.svg'),
    hasPublicFavicon: byPath.has('public/favicon.svg'),
    hasPublicViteSvg: byPath.has('public/vite.svg'),
  })
}

for (const signature of signatures) {
  assertChecks(signature)
}

console.log('✅ React Vite variant fingerprints are valid')
for (const signature of signatures) {
  console.log(
    `- ${signature.variant}: ${signature.buildScript} | swc=${signature.vitePluginSwc} | compiler=${signature.viteCompilerEnabled}`,
  )
}
console.log(`📁 Generated verification files: ${outRoot}`)
