import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import { clerkMiddleware, getAuth } from '@clerk/express'
import { verifyToken } from '@clerk/backend'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'
import { Client } from 'pg'
import os from 'node:os'
import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import { enqueueExecutionJob } from './queue/executionQueue.js'
import { isRedisConfigured } from './queue/redis.js'
import { configureCloudinary, isCloudinaryConfigured } from './storage/cloudinaryClient.js'
import * as fileStorage from './storage/fileStorage.js'

dotenv.config()
configureCloudinary()

process.on('unhandledRejection', (reason) => {
  const nestedError = reason?.error
  const reasonCode = String(reason?.code || nestedError?.code || '')
  const reasonPath = String(reason?.path || nestedError?.path || '')
  const looksLikeDataTextPath = /data:text[\\/]+plain;base64,?$/i.test(reasonPath)

  if (reasonCode === 'ENOENT' && looksLikeDataTextPath) {
    return
  }

  const detail =
    reason instanceof Error
      ? `${reason.message}\n${reason.stack || ''}`
      : (() => {
          try {
            return JSON.stringify(reason)
          } catch {
            return String(reason)
          }
        })()

  console.error('[unhandledRejection] Prevented process crash. Reason:', detail)
})

process.on('rejectionHandled', () => {})

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
})

const PORT = process.env.PORT || 4000
const CLERK_SECRET_KEY = String(process.env.CLERK_SECRET_KEY || '').trim()
const CLERK_PUBLISHABLE_KEY = String(process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim()
const CLERK_CLOCK_SKEW_MS = Math.max(0, Number(process.env.CLERK_CLOCK_SKEW_MS || 60000))
const DATABASE_URL = process.env.DATABASE_URL
const USE_DOCKER = process.env.USE_DOCKER === 'true'
const USE_EXECUTION_QUEUE = process.env.USE_EXECUTION_QUEUE === 'true'
const LIVEKIT_URL = String(process.env.LIVEKIT_URL || '').trim()
const LIVEKIT_API_KEY = String(process.env.LIVEKIT_API_KEY || '').trim()
const LIVEKIT_API_SECRET = String(process.env.LIVEKIT_API_SECRET || '').trim()
const GITHUB_CLIENT_ID = String(process.env.GITHUB_CLIENT_ID || '').trim()
const GITHUB_CLIENT_SECRET = String(process.env.GITHUB_CLIENT_SECRET || '').trim()
const GITHUB_OAUTH_CALLBACK_URL = String(process.env.GITHUB_OAUTH_CALLBACK_URL || 'http://localhost:4000/api/github/oauth/callback').trim()
const FRONTEND_BASE_URL = String(process.env.FRONTEND_BASE_URL || 'http://localhost:5173').trim()
const GITHUB_DEFAULT_COMMIT_MESSAGE = 'Initial upload from DC Editor'

const toLiveKitApiUrl = (value = '') => {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  if (/^wss?:\/\//i.test(normalized)) {
    return normalized.replace(/^ws/i, 'http')
  }
  return normalized
}

const normalizeRealtimeAvatarUrl = (value = '') => {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  // Data URLs can make JWT metadata too large and break websocket handshake.
  if (normalized.startsWith('data:')) return ''
  if (normalized.length > 1024) return ''
  return normalized
}

const normalizeAvatarForUi = (value = '') => {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  // Keep responses bounded, but allow data URLs for profile avatars in UI.
  if (normalized.length > 2 * 1024 * 1024) return ''
  return normalized
}

app.use(cors())
app.use(express.json({ limit: '15mb' }))
if (CLERK_SECRET_KEY) {
  app.use(
    clerkMiddleware({
      secretKey: CLERK_SECRET_KEY,
      publishableKey: CLERK_PUBLISHABLE_KEY || undefined,
    }),
  )
}

const users = new Map()
const usersByEmail = new Map()
const githubOauthStates = new Map()
const projects = new Map()
const invitations = new Map()
const terminalSessions = new Map()
const terminalDisconnectStopTimers = new Map()
const livePreviewSessions = new Map()
const executionJobs = new Map()
const pendingProjectPersistTimers = new Map()
const pendingWorkspaceFileSyncTimers = new Map()
const PROJECT_PERSIST_DEBOUNCE_MS = 900
const WORKSPACE_FILE_SYNC_DEBOUNCE_MS = 40
const TERMINAL_WORKSPACES_ROOT = path.join(process.cwd(), '.tw')
const LOCAL_STATE_PATH = path.join(process.cwd(), '.collab-state.json')
const LIVE_PREVIEW_SESSION_TTL_MS = 1000 * 60 * 60 * 6
let dbClient = null

const scheduleProjectPersist = (projectId, delayMs = PROJECT_PERSIST_DEBOUNCE_MS) => {
  const normalizedProjectId = String(projectId || '').trim()
  if (!normalizedProjectId) return

  const existing = pendingProjectPersistTimers.get(normalizedProjectId)
  if (existing) {
    clearTimeout(existing)
  }

  const timerId = setTimeout(async () => {
    pendingProjectPersistTimers.delete(normalizedProjectId)
    const project = projects.get(normalizedProjectId)
    if (!project) return

    try {
      await persistProject(project)
    } catch (error) {
      console.error('Debounced project persist failed:', error)
    }
  }, Math.max(0, Number(delayMs) || PROJECT_PERSIST_DEBOUNCE_MS))

  pendingProjectPersistTimers.set(normalizedProjectId, timerId)
}

const SERVER_ROOT = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_ROOT = path.join(SERVER_ROOT, 'templates')

function readTemplateTextFile(filename, fallback = '') {
  try {
    return fs.readFileSync(path.join(TEMPLATE_ROOT, filename), 'utf8')
  } catch {
    return fallback
  }
}

function readTemplateBase64File(filename, fallback = '') {
  const content = readTemplateTextFile(filename, fallback)
  return String(content || '').replace(/\s+/g, '')
}

const NEXT_TEMPLATE_CACHE_LIFE = readTemplateTextFile(
  'next-cache-life.d.ts',
  '// Auto-generated by Next.js\n// Added in template for editor parity\n\nexport {}\n',
)
const NEXT_TEMPLATE_ROUTES = readTemplateTextFile(
  'next-routes.d.ts',
  '// Auto-generated by Next.js\n// Added in template for editor parity\n\ndeclare namespace __next_route_internal_types__ {\n  type AppRoutes = "/"\n}\n\nexport {}\n',
)
const NEXT_TEMPLATE_VALIDATOR = readTemplateTextFile(
  'next-validator.ts',
  '// Auto-generated by Next.js\n// Added in template for editor parity\n\nexport {}\n',
)
const NEXT_TEMPLATE_FAVICON_BASE64 = readTemplateBase64File('next-favicon.b64')
const NEXT_TEMPLATE_FAVICON_DATA_URL = NEXT_TEMPLATE_FAVICON_BASE64
  ? `data:image/x-icon;base64,${NEXT_TEMPLATE_FAVICON_BASE64}`
  : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAAdUlEQVR4Ae3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4G8GfAABk6nS9QAAAABJRU5ErkJggg=='
const NEXT_TEMPLATE_FAVICON_SIZE_BYTES = NEXT_TEMPLATE_FAVICON_BASE64
  ? Buffer.from(NEXT_TEMPLATE_FAVICON_BASE64, 'base64').length
  : 196

const REACT_VITE_VARIANTS = [
  { id: 'typescript', label: 'TypeScript', defaultLanguage: 'typescript' },
  { id: 'typescript-tailwind', label: 'TypeScript + Tailwind', defaultLanguage: 'typescript' },
  { id: 'typescript-react-compiler', label: 'TypeScript + React Compiler', defaultLanguage: 'typescript' },
  { id: 'typescript-swc', label: 'TypeScript + SWC', defaultLanguage: 'typescript' },
  { id: 'javascript', label: 'JavaScript', defaultLanguage: 'javascript' },
  { id: 'javascript-react-compiler', label: 'JavaScript + React Compiler', defaultLanguage: 'javascript' },
  { id: 'javascript-swc', label: 'JavaScript + SWC', defaultLanguage: 'javascript' },
]

const reactViteVariantMap = new Map(REACT_VITE_VARIANTS.map((variant) => [variant.id, variant]))

const REACT_README_JS = `This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [\`typescript-eslint\`](https://typescript-eslint.io) in your project.
`

const REACT_README_TS = `This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

\`\`\`js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
\`\`\`

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

\`\`\`js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
\`\`\`
`

const REACT_COMPILER_README_BODY =
  'The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.\n\nNote: This will impact Vite dev & build performances.'

const buildReactViteReadme = ({ useTypeScript, useReactCompiler }) => {
  const title = useTypeScript ? '# React + TypeScript + Vite' : '# React + Vite'
  const body = useTypeScript ? REACT_README_TS : REACT_README_JS
  const full = `${title}\n\n${body}`

  if (!useReactCompiler) {
    return full
  }

  return full.replace(
    'The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).',
    REACT_COMPILER_README_BODY,
  )
}

const buildReactVitePackageJson = ({ projectName, useTypeScript, useSwc, useReactCompiler }) => {
  const dependencies = {
    react: '^19.2.4',
    'react-dom': '^19.2.4',
  }

  const devDependencies = {
    '@eslint/js': '^9.39.3',
    '@types/react': '^19.2.14',
    '@types/react-dom': '^19.2.3',
    ...(useTypeScript ? { '@types/node': '^24.10.13' } : {}),
    ...(useSwc ? { '@vitejs/plugin-react-swc': '^4.1.0' } : { '@vitejs/plugin-react': '^5.1.4' }),
    eslint: '^9.39.3',
    'eslint-plugin-react-hooks': '^7.0.1',
    'eslint-plugin-react-refresh': '^0.5.2',
    globals: '^17.3.0',
    ...(useTypeScript
      ? {
          typescript: '~5.9.3',
          'typescript-eslint': '^8.56.1',
        }
      : {}),
    vite: '^7.3.1',
    ...(useReactCompiler ? { 'babel-plugin-react-compiler': '^1.0.0' } : {}),
  }

  return JSON.stringify(
    {
      name: projectName,
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: useTypeScript ? 'tsc -b && vite build' : 'vite build',
        lint: 'eslint .',
        preview: 'vite preview',
      },
      dependencies,
      devDependencies,
    },
    null,
    2,
  ) + '\n'
}

const reactBaseCss = `:root {
  font-family: system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  font-weight: 500;
  color: #646cff;
  text-decoration: inherit;
}
a:hover {
  color: #535bf2;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
  a:hover {
    color: #747bff;
  }
  button {
    background-color: #f9f9f9;
  }
}
`

const reactSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 841.9 595.3"><g fill="#61dafb"><path d="M666.3 296.5c0-32.5-40.7-63.3-103.1-85.4 14.4-63.8 8-114.2-20.6-131-6.6-3.8-14.3-5.8-22.4-5.8v23c4.1 0 7.9.9 11.3 2.8 13.8 7.9 19.7 40.5 15.2 83.1-1.1 10.4-2.8 21.3-5 32.5-19.6-4.7-41-8.3-63.9-10.8-13.8-18.9-28.2-36.2-42.9-51.4 33.8-31.4 65.4-48.6 87.8-48.6V82c-29.1 0-66.8 20.7-106.4 58.2-39.6-37.4-77.1-58.2-106.4-58.2v23c22.3 0 53.7 17.1 87.4 48.2-14.6 15.2-29 32.5-42.6 51.3-23 2.5-44.4 6.2-64.1 10.9-2.2-11.2-3.9-22.1-5-32.6-4.6-42.5 1.2-75.1 14.9-83 3.3-1.9 7-2.8 11.1-2.8V74c-8.1 0-15.7 1.9-22.2 5.7-28.6 16.5-35.1 66.7-20.8 130.4-62.1 22.1-102.7 52.9-102.7 85.4 0 32.5 40.7 63.3 103.1 85.4-14.4 63.8-8 114.2 20.6 131 6.6 3.8 14.3 5.8 22.4 5.8 29.2 0 66.8-20.7 106.4-58.2 39.6 37.4 77.1 58.2 106.4 58.2 8.1 0 15.8-1.9 22.4-5.8 28.6-16.5 35-66.7 20.6-130.8 62.3-22.2 103-53 103-85.5zm-130.4 70.6c-5 17.3-11.3 35.3-18.8 53.5-17.2 3.8-35.9 6.7-55.8 8.7 6.4-5.5 12.9-11.3 19.4-17.3 6.5-6 12.8-12.1 18.8-18.4 12.7-1.9 24.9-4.1 36.4-6.5z"/></g></svg>`

const viteSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 410 404"><path fill="#41D1FF" d="M399.641 59.524L215.643 388.545c-3.79 6.743-13.495 6.747-17.29.007L9.32 59.575c-4.161-7.304 2.185-16.227 10.435-14.684l184.143 34.437a10 10 0 0 0 3.675 0l181.615-34.397c8.243-1.562 14.602 7.331 10.453 14.593Z"/><path fill="#BD34FE" d="M292.965.84 156.412 27.634a5 5 0 0 0-4.068 4.156L130.355 176.35a5 5 0 0 0 6.104 5.64l38.002-8.761a5 5 0 0 1 6.064 6.123l-11.29 55.28a5 5 0 0 0 6.08 5.909l23.468-5.719a5 5 0 0 1 6.2 5.62l-17.945 87.35c-1.123 5.468 6.152 8.453 9.146 3.762l1.999-3.128 111.25-221.98a5 5 0 0 0-5.45-7.143l-39.124 7.548a5 5 0 0 1-5.767-6.26l25.52-88.34a5 5 0 0 0-5.637-6.367Z"/></svg>`

const buildReactViteVariantFiles = ({ name, variantId }) => {
  const variant = reactViteVariantMap.get(variantId) || reactViteVariantMap.get('typescript')
  if (variant.id === 'typescript-tailwind') {
    return buildReactTsTailwindFiles({ name })
  }

  const useTypeScript = variant.id.startsWith('typescript')
  const useSwc = variant.id.endsWith('swc')
  const useReactCompiler = variant.id.includes('react-compiler')
  const appExt = useTypeScript ? 'tsx' : 'jsx'
  const mainExt = useTypeScript ? 'tsx' : 'jsx'

  const appContent = "import { useState } from 'react'\nimport reactLogo from './assets/react.svg'\nimport viteLogo from './assets/vite.svg'\nimport './App.css'\n\nfunction App() {\n  const [count, setCount] = useState(0)\n\n  return (\n    <>\n      <div>\n        <a href=\"https://vite.dev\" target=\"_blank\">\n          <img src={viteLogo} className=\"logo\" alt=\"Vite logo\" />\n        </a>\n        <a href=\"https://react.dev\" target=\"_blank\">\n          <img src={reactLogo} className=\"logo react\" alt=\"React logo\" />\n        </a>\n      </div>\n      <h1>Vite + React</h1>\n      <div className=\"card\">\n        <button onClick={() => setCount((count) => count + 1)}>\n          count is {count}\n        </button>\n        <p>\n          Edit <code>src/App." + appExt + "</code> and save to test HMR\n        </p>\n      </div>\n      <p className=\"read-the-docs\">\n        Click on the Vite and React logos to learn more\n      </p>\n    </>\n  )\n}\n\nexport default App\n"

  const mainContent = useTypeScript
    ? `import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport './index.css'\nimport App from './App.${appExt}'\n\ncreateRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)\n`
    : `import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport './index.css'\nimport App from './App.${appExt}'\n\ncreateRoot(document.getElementById('root')).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)\n`

  const vitePluginImport = useSwc ? "import react from '@vitejs/plugin-react-swc'" : "import react from '@vitejs/plugin-react'"
  const vitePluginUsage = useReactCompiler
    ? "react({\n      babel: {\n        plugins: ['babel-plugin-react-compiler'],\n      },\n    })"
    : 'react()'

  const files = [
    {
      path: '.gitignore',
      content:
        '# Logs\nlogs\n*.log\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\npnpm-debug.log*\nlerna-debug.log*\n\nnode_modules\ndist\ndist-ssr\n*.local\n\n# Editor directories and files\n.vscode/*\n!.vscode/extensions.json\n.idea\n.DS_Store\n*.suo\n*.ntvs*\n*.njsproj\n*.sln\n*.sw?\n',
    },
    {
      path: 'README.md',
      content: buildReactViteReadme({
        useTypeScript,
        useReactCompiler,
      }),
    },
    {
      path: 'index.html',
      content:
        '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>' +
        'Vite + React' +
        '</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.' +
        mainExt +
        '"></script>\n  </body>\n</html>\n',
    },
    { path: 'public/favicon.svg', content: viteSvg },
    { path: 'src/assets/react.svg', content: reactSvg },
    { path: 'src/assets/vite.svg', content: viteSvg },
    { path: `src/main.${mainExt}`, content: mainContent },
    { path: `src/App.${appExt}`, content: appContent },
    {
      path: 'src/App.css',
      content:
        '#root {\n  max-width: 1280px;\n  margin: 0 auto;\n  padding: 2rem;\n  text-align: center;\n}\n\n.logo {\n  height: 6em;\n  padding: 1.5em;\n  will-change: filter;\n  transition: filter 300ms;\n}\n.logo:hover {\n  filter: drop-shadow(0 0 2em #646cffaa);\n}\n.logo.react:hover {\n  filter: drop-shadow(0 0 2em #61dafbaa);\n}\n\n@keyframes logo-spin {\n  from {\n    transform: rotate(0deg);\n  }\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n@media (prefers-reduced-motion: no-preference) {\n  a:nth-of-type(2) .logo {\n    animation: logo-spin infinite 20s linear;\n  }\n}\n\n.card {\n  padding: 2em;\n}\n\n.read-the-docs {\n  color: #888;\n}\n',
    },
    { path: 'src/index.css', content: reactBaseCss },
    {
      path: 'eslint.config.js',
      content: useTypeScript
        ? "import js from '@eslint/js'\nimport globals from 'globals'\nimport reactHooks from 'eslint-plugin-react-hooks'\nimport reactRefresh from 'eslint-plugin-react-refresh'\nimport tseslint from 'typescript-eslint'\nimport { defineConfig, globalIgnores } from 'eslint/config'\n\nexport default defineConfig([\n  globalIgnores(['dist']),\n  {\n    files: ['**/*.{ts,tsx}'],\n    extends: [\n      js.configs.recommended,\n      tseslint.configs.recommended,\n      reactHooks.configs.flat.recommended,\n      reactRefresh.configs.vite,\n    ],\n    languageOptions: {\n      ecmaVersion: 2020,\n      globals: globals.browser,\n    },\n  },\n])\n"
        : "import js from '@eslint/js'\nimport globals from 'globals'\nimport reactHooks from 'eslint-plugin-react-hooks'\nimport reactRefresh from 'eslint-plugin-react-refresh'\nimport { defineConfig, globalIgnores } from 'eslint/config'\n\nexport default defineConfig([\n  globalIgnores(['dist']),\n  {\n    files: ['**/*.{js,jsx}'],\n    extends: [\n      js.configs.recommended,\n      reactHooks.configs.flat.recommended,\n      reactRefresh.configs.vite,\n    ],\n    languageOptions: {\n      ecmaVersion: 2020,\n      globals: globals.browser,\n      parserOptions: {\n        ecmaVersion: 'latest',\n        ecmaFeatures: { jsx: true },\n        sourceType: 'module',\n      },\n    },\n    rules: {\n      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],\n    },\n  },\n])\n",
    },
    {
      path: useTypeScript ? 'vite.config.ts' : 'vite.config.js',
      content:
        `${vitePluginImport}\nimport { defineConfig } from 'vite'\n\n// https://vite.dev/config/\nexport default defineConfig({\n  plugins: [${vitePluginUsage}],\n})\n`,
    },
    {
      path: 'package.json',
      content: buildReactVitePackageJson({
        projectName: String(name || 'react-vite-app')
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '') || 'react-vite-app',
        useTypeScript,
        useSwc,
        useReactCompiler,
      }),
    },
  ]

  if (useTypeScript) {
    files.push(
      {
        path: 'tsconfig.app.json',
        content:
          '{\n  "compilerOptions": {\n    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",\n    "target": "ES2023",\n    "useDefineForClassFields": true,\n    "lib": ["ES2023", "DOM", "DOM.Iterable"],\n    "module": "ESNext",\n    "types": ["vite/client"],\n    "skipLibCheck": true,\n\n    /* Bundler mode */\n    "moduleResolution": "bundler",\n    "allowImportingTsExtensions": true,\n    "verbatimModuleSyntax": true,\n    "moduleDetection": "force",\n    "noEmit": true,\n    "jsx": "react-jsx",\n\n    /* Linting */\n    "strict": true,\n    "noUnusedLocals": true,\n    "noUnusedParameters": true,\n    "erasableSyntaxOnly": true,\n    "noFallthroughCasesInSwitch": true,\n    "noUncheckedSideEffectImports": true\n  },\n  "include": ["src"]\n}\n',
      },
      {
        path: 'tsconfig.node.json',
        content:
          '{\n  "compilerOptions": {\n    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",\n    "target": "ES2023",\n    "lib": ["ES2023"],\n    "module": "ESNext",\n    "types": ["node"],\n    "skipLibCheck": true,\n\n    /* Bundler mode */\n    "moduleResolution": "bundler",\n    "allowImportingTsExtensions": true,\n    "verbatimModuleSyntax": true,\n    "moduleDetection": "force",\n    "noEmit": true,\n\n    /* Linting */\n    "strict": true,\n    "noUnusedLocals": true,\n    "noUnusedParameters": true,\n    "erasableSyntaxOnly": true,\n    "noFallthroughCasesInSwitch": true,\n    "noUncheckedSideEffectImports": true\n  },\n  "include": ["vite.config.ts"]\n}\n',
      },
      {
        path: 'tsconfig.json',
        content: '{\n  "files": [],\n  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]\n}\n',
      },
    )
  }

  return files
}

const buildReactTsTailwindFiles = ({ name }) => {
  const packageName = sanitizePackageName(name, 'react-ts-tailwind-app')

  return [
    {
      path: '.gitignore',
      content:
        '# Logs\nlogs\n*.log\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\npnpm-debug.log*\nlerna-debug.log*\n\nnode_modules\ndist\ndist-ssr\n*.local\n\n# Editor directories and files\n.vscode/*\n!.vscode/extensions.json\n.idea\n.DS_Store\n*.suo\n*.ntvs*\n*.njsproj\n*.sln\n*.sw?\n',
    },
    {
      path: 'README.md',
      content:
        `# React + TypeScript + Vite + Tailwind CSS\n\nProduction-ready frontend starter with modern defaults and VS Code-friendly tooling.\n\n## Environment Provided\n\n- React 19 + React DOM 19\n- TypeScript 5 (strict mode)\n- Vite 7 + \`@vitejs/plugin-react\`\n- Tailwind CSS 4 via \`@tailwindcss/vite\`\n- ESLint 9 with TypeScript + React hooks rules\n\n## Quick Start\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## Common Commands\n\n\`\`\`bash\nnpm run typecheck\nnpm run lint\nnpm run build\nnpm run preview\n\`\`\`\n\n## Notes\n\n- Tailwind v4 is enabled through the Vite plugin and \`@import "tailwindcss";\` in \`src/index.css\`.\n- This template is intentionally minimal so you can start building immediately without removing demo complexity.\n`,
    },
    {
      path: 'index.html',
      content:
        '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <link rel="icon" type="image/svg+xml" href="/vite.svg" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Vite + React + TS + Tailwind</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n',
    },
    { path: 'public/vite.svg', content: viteSvg },
    { path: 'src/main.tsx', content: "import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport './index.css'\nimport App from './App.tsx'\n\ncreateRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)\n" },
    {
      path: 'src/App.tsx',
      content:
        "function App() {\n  return (\n    <main className=\"min-h-screen bg-slate-950 text-slate-100 grid place-items-center px-6\">\n      <div className=\"text-center space-y-4\">\n        <h1 className=\"text-4xl font-bold tracking-tight\">React + TypeScript + Tailwind</h1>\n        <p className=\"text-slate-300\">Edit <code className=\"rounded bg-slate-800 px-2 py-1\">src/App.tsx</code> and save to test HMR.</p>\n      </div>\n    </main>\n  )\n}\n\nexport default App\n",
    },
    { path: 'src/index.css', content: '@import "tailwindcss";\n' },
    {
      path: 'eslint.config.js',
      content:
        "import js from '@eslint/js'\nimport globals from 'globals'\nimport reactHooks from 'eslint-plugin-react-hooks'\nimport reactRefresh from 'eslint-plugin-react-refresh'\nimport tseslint from 'typescript-eslint'\nimport { defineConfig, globalIgnores } from 'eslint/config'\n\nexport default defineConfig([\n  globalIgnores(['dist']),\n  {\n    files: ['**/*.{ts,tsx}'],\n    extends: [\n      js.configs.recommended,\n      tseslint.configs.recommended,\n      reactHooks.configs.flat.recommended,\n      reactRefresh.configs.vite,\n    ],\n    languageOptions: {\n      ecmaVersion: 2020,\n      globals: globals.browser,\n    },\n  },\n])\n",
    },
    {
      path: 'vite.config.ts',
      content:
        "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nimport tailwindcss from '@tailwindcss/vite'\n\nexport default defineConfig({\n  plugins: [react(), tailwindcss()],\n})\n",
    },
    {
      path: 'tsconfig.app.json',
      content:
        '{\n  "compilerOptions": {\n    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",\n    "target": "ES2023",\n    "useDefineForClassFields": true,\n    "lib": ["ES2023", "DOM", "DOM.Iterable"],\n    "module": "ESNext",\n    "types": ["vite/client"],\n    "skipLibCheck": true,\n\n    /* Bundler mode */\n    "moduleResolution": "bundler",\n    "allowImportingTsExtensions": true,\n    "verbatimModuleSyntax": true,\n    "moduleDetection": "force",\n    "noEmit": true,\n    "jsx": "react-jsx",\n\n    /* Linting */\n    "strict": true,\n    "noUnusedLocals": true,\n    "noUnusedParameters": true,\n    "erasableSyntaxOnly": true,\n    "noFallthroughCasesInSwitch": true,\n    "noUncheckedSideEffectImports": true\n  },\n  "include": ["src"]\n}\n',
    },
    {
      path: 'tsconfig.node.json',
      content:
        '{\n  "compilerOptions": {\n    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",\n    "target": "ES2023",\n    "lib": ["ES2023"],\n    "module": "ESNext",\n    "types": ["node"],\n    "skipLibCheck": true,\n\n    /* Bundler mode */\n    "moduleResolution": "bundler",\n    "allowImportingTsExtensions": true,\n    "verbatimModuleSyntax": true,\n    "moduleDetection": "force",\n    "noEmit": true,\n\n    /* Linting */\n    "strict": true,\n    "noUnusedLocals": true,\n    "noUnusedParameters": true,\n    "erasableSyntaxOnly": true,\n    "noFallthroughCasesInSwitch": true,\n    "noUncheckedSideEffectImports": true\n  },\n  "include": ["vite.config.ts"]\n}\n',
    },
    {
      path: 'tsconfig.json',
      content:
        '{\n  "files": [],\n  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]\n}\n',
    },
    {
      path: '.vscode/extensions.json',
      content:
        '{\n  "recommendations": [\n    "dbaeumer.vscode-eslint",\n    "esbenp.prettier-vscode",\n    "bradlc.vscode-tailwindcss"\n  ]\n}\n',
    },
    {
      path: '.vscode/settings.json',
      content:
        '{\n  "editor.formatOnSave": true,\n  "editor.codeActionsOnSave": {\n    "source.fixAll.eslint": "explicit"\n  },\n  "typescript.tsdk": "node_modules/typescript/lib"\n}\n',
    },
    {
      path: 'package.json',
      content:
        JSON.stringify(
          {
            name: packageName,
            private: true,
            version: '0.0.0',
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'tsc -b && vite build',
              typecheck: 'tsc --noEmit',
              lint: 'eslint .',
              preview: 'vite preview',
            },
            dependencies: {
              react: '^19.2.4',
              'react-dom': '^19.2.4',
            },
            devDependencies: {
              '@eslint/js': '^9.39.3',
              '@tailwindcss/vite': '^4.1.12',
              '@types/node': '^24.10.13',
              '@types/react': '^19.2.14',
              '@types/react-dom': '^19.2.3',
              '@vitejs/plugin-react': '^5.1.4',
              eslint: '^9.39.3',
              'eslint-plugin-react-hooks': '^7.0.1',
              'eslint-plugin-react-refresh': '^0.5.2',
              globals: '^17.3.0',
              tailwindcss: '^4.1.12',
              typescript: '~5.9.3',
              'typescript-eslint': '^8.56.1',
              vite: '^7.3.1',
            },
          },
          null,
          2,
        ) + '\n',
    },
  ]
}

const NODE_EXPRESS_VARIANTS = [
  { id: 'javascript', label: 'JavaScript', defaultLanguage: 'javascript' },
  { id: 'typescript', label: 'TypeScript', defaultLanguage: 'typescript' },
]

const nodeExpressVariantMap = new Map(NODE_EXPRESS_VARIANTS.map((variant) => [variant.id, variant]))

const buildNodeExpressVariantFiles = ({ name, variantId }) => {
  const variant = nodeExpressVariantMap.get(variantId) || nodeExpressVariantMap.get('javascript')
  const useTypeScript = variant.id === 'typescript'

  const ext = useTypeScript ? 'ts' : 'js'

  const commonFiles = [
    {
      path: 'README.md',
      content:
        `# ${name}\n\nProduction-ready Node.js + Express starter with common defaults.\n\n## Features\n\n- Express API with structured app/server split\n- Security + DX middleware (` + '`helmet`' + `, ` + '`cors`' + `, ` + '`morgan`' + `)\n- Env loading via ` + '`dotenv`' + `\n- Centralized 404 + error handlers\n- ESLint + Prettier setup\n- Variant: ` + (useTypeScript ? '`TypeScript`' : '`JavaScript`') + `\n\n## Quick Start\n\n1. Install dependencies\n\n   ` + '```bash' + `\n   npm install\n   ` + '```' + `\n\n2. Create environment file\n\n   ` + '```bash' + `\n   cp .env.example .env\n   ` + '```' + `\n\n3. Start development server\n\n   ` + '```bash' + `\n   npm run dev\n   ` + '```' + `\n\n## Scripts\n\n- ` + '`npm run dev`' + `: start dev server\n- ` + '`npm run start`' + `: start production server\n- ` + '`npm run lint`' + `: run ESLint\n- ` + '`npm run lint:fix`' + `: fix lint issues\n- ` + '`npm run format`' + `: format with Prettier\n- ` + '`npm run format:check`' + `: check formatting\n` + (useTypeScript ? '- `npm run build`: compile TypeScript to dist\n- `npm run typecheck`: run TypeScript checks\n' : '') + `\n## Endpoints\n\n- ` + '`GET /health`' + `: API health check\n- ` + '`GET /api`' + `: API welcome response\n`,
    },
    {
      path: '.env.example',
      content: 'NODE_ENV=development\nPORT=3000\nCORS_ORIGIN=http://localhost:5173\n',
    },
    {
      path: '.gitignore',
      content:
        '# dependencies\nnode_modules/\n\n# env files\n.env\n.env.*\n!.env.example\n\n# logs\nlogs\n*.log\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\npnpm-debug.log*\n\n# runtime\n*.pid\n*.seed\n*.pid.lock\n\n# coverage\ncoverage/\n.nyc_output/\n\n# build\ndist/\nbuild/\n\n# OS/editor\n.DS_Store\nThumbs.db\n.vscode/\n.idea/\n',
    },
    {
      path: '.prettierrc',
      content:
        '{\n  "semi": false,\n  "singleQuote": true,\n  "trailingComma": "all",\n  "printWidth": 100\n}\n',
    },
    {
      path: 'src/config/env.' + ext,
      content: useTypeScript
        ? "import 'dotenv/config'\n\nconst parsePort = (value: unknown, fallback = 3000): number => {\n  const parsed = Number(value)\n  if (!Number.isInteger(parsed)) return fallback\n  if (parsed < 1 || parsed > 65535) return fallback\n  return parsed\n}\n\nexport const env = {\n  NODE_ENV: process.env.NODE_ENV || 'development',\n  PORT: parsePort(process.env.PORT, 3000),\n  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',\n}\n"
        : "import 'dotenv/config'\n\nconst parsePort = (value, fallback = 3000) => {\n  const parsed = Number(value)\n  if (!Number.isInteger(parsed)) return fallback\n  if (parsed < 1 || parsed > 65535) return fallback\n  return parsed\n}\n\nexport const env = {\n  NODE_ENV: process.env.NODE_ENV || 'development',\n  PORT: parsePort(process.env.PORT, 3000),\n  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',\n}\n",
    },
    {
      path: 'src/middleware/notFound.' + ext,
      content: useTypeScript
        ? "import type { Request, Response } from 'express'\n\nexport function notFoundHandler(req: Request, res: Response) {\n  res.status(404).json({\n    ok: false,\n    message: `Route not found: ${req.method} ${req.originalUrl}`,\n  })\n}\n"
        : "export function notFoundHandler(req, res) {\n  res.status(404).json({\n    ok: false,\n    message: `Route not found: ${req.method} ${req.originalUrl}`,\n  })\n}\n",
    },
    {
      path: 'src/middleware/errorHandler.' + ext,
      content: useTypeScript
        ? "import type { NextFunction, Request, Response } from 'express'\nimport { env } from '../config/env.js'\n\nexport function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {\n  const status = Number(err?.status || err?.statusCode || 500)\n  const message =\n    status >= 500 && env.NODE_ENV === 'production'\n      ? 'Internal Server Error'\n      : err?.message || 'Internal Server Error'\n\n  res.status(status).json({\n    ok: false,\n    message,\n    ...(env.NODE_ENV !== 'production' && err?.stack ? { stack: err.stack } : {}),\n  })\n}\n"
        : "import { env } from '../config/env.js'\n\nexport function errorHandler(err, req, res, _next) {\n  const status = Number(err?.status || err?.statusCode || 500)\n  const message =\n    status >= 500 && env.NODE_ENV === 'production'\n      ? 'Internal Server Error'\n      : err?.message || 'Internal Server Error'\n\n  res.status(status).json({\n    ok: false,\n    message,\n    ...(env.NODE_ENV !== 'production' && err?.stack ? { stack: err.stack } : {}),\n  })\n}\n",
    },
    {
      path: 'src/routes/index.' + ext,
      content: useTypeScript
        ? "import { Router } from 'express'\n\nconst router = Router()\n\nrouter.get('/', (_req, res) => {\n  res.json({\n    ok: true,\n    message: 'Node + Express starter is running',\n  })\n})\n\nexport default router\n"
        : "import { Router } from 'express'\n\nconst router = Router()\n\nrouter.get('/', (_req, res) => {\n  res.json({\n    ok: true,\n    message: 'Node + Express starter is running',\n  })\n})\n\nexport default router\n",
    },
    {
      path: 'src/app.' + ext,
      content: useTypeScript
        ? "import express from 'express'\nimport cors from 'cors'\nimport helmet from 'helmet'\nimport morgan from 'morgan'\nimport { env } from './config/env.js'\nimport apiRouter from './routes/index.js'\nimport { notFoundHandler } from './middleware/notFound.js'\nimport { errorHandler } from './middleware/errorHandler.js'\n\nconst app = express()\n\napp.disable('x-powered-by')\napp.use(helmet())\n\nlet corsOrigin: true | string[] = true\nif (env.CORS_ORIGIN !== '*') {\n  const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)\n  corsOrigin = allowedOrigins.length ? allowedOrigins : true\n}\n\napp.use(cors({\n  origin: corsOrigin,\n  credentials: true,\n}))\n\napp.use(express.json({ limit: '1mb' }))\napp.use(express.urlencoded({ extended: true }))\n\nif (env.NODE_ENV !== 'test') {\n  app.use(morgan('dev'))\n}\n\napp.get('/health', (_req, res) => {\n  res.json({\n    ok: true,\n    service: 'api',\n    uptime: process.uptime(),\n    timestamp: new Date().toISOString(),\n  })\n})\n\napp.use('/api', apiRouter)\n\napp.use(notFoundHandler)\napp.use(errorHandler)\n\nexport default app\n"
        : "import express from 'express'\nimport cors from 'cors'\nimport helmet from 'helmet'\nimport morgan from 'morgan'\nimport { env } from './config/env.js'\nimport apiRouter from './routes/index.js'\nimport { notFoundHandler } from './middleware/notFound.js'\nimport { errorHandler } from './middleware/errorHandler.js'\n\nconst app = express()\n\napp.disable('x-powered-by')\napp.use(helmet())\n\nconst corsOrigin = env.CORS_ORIGIN === '*'\n  ? true\n  : env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)\n\napp.use(cors({\n  origin: corsOrigin.length ? corsOrigin : true,\n  credentials: true,\n}))\n\napp.use(express.json({ limit: '1mb' }))\napp.use(express.urlencoded({ extended: true }))\n\nif (env.NODE_ENV !== 'test') {\n  app.use(morgan('dev'))\n}\n\napp.get('/health', (_req, res) => {\n  res.json({\n    ok: true,\n    service: 'api',\n    uptime: process.uptime(),\n    timestamp: new Date().toISOString(),\n  })\n})\n\napp.use('/api', apiRouter)\n\napp.use(notFoundHandler)\napp.use(errorHandler)\n\nexport default app\n",
    },
    {
      path: 'src/server.' + ext,
      content: useTypeScript
        ? "import http from 'node:http'\nimport app from './app.js'\nimport { env } from './config/env.js'\n\nconst server = http.createServer(app)\n\nserver.listen(env.PORT, '0.0.0.0', () => {\n  console.log(`Server running on http://localhost:${env.PORT}`)\n})\n\nconst shutdown = (signal: NodeJS.Signals) => {\n  console.log(`${signal} received. Shutting down gracefully...`)\n  server.close((error) => {\n    if (error) {\n      console.error('Error during shutdown:', error)\n      process.exit(1)\n    }\n    process.exit(0)\n  })\n}\n\nprocess.on('SIGINT', () => shutdown('SIGINT'))\nprocess.on('SIGTERM', () => shutdown('SIGTERM'))\n"
        : "import http from 'node:http'\nimport app from './app.js'\nimport { env } from './config/env.js'\n\nconst server = http.createServer(app)\n\nserver.listen(env.PORT, '0.0.0.0', () => {\n  console.log(`Server running on http://localhost:${env.PORT}`)\n})\n\nconst shutdown = (signal) => {\n  console.log(`${signal} received. Shutting down gracefully...`)\n  server.close((error) => {\n    if (error) {\n      console.error('Error during shutdown:', error)\n      process.exit(1)\n    }\n    process.exit(0)\n  })\n}\n\nprocess.on('SIGINT', () => shutdown('SIGINT'))\nprocess.on('SIGTERM', () => shutdown('SIGTERM'))\n",
    },
  ]

  if (useTypeScript) {
    commonFiles.push(
      {
        path: 'tsconfig.json',
        content:
          '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "NodeNext",\n    "moduleResolution": "NodeNext",\n    "lib": ["ES2022"],\n    "strict": true,\n    "skipLibCheck": true,\n    "esModuleInterop": true,\n    "forceConsistentCasingInFileNames": true,\n    "resolveJsonModule": true,\n    "outDir": "dist",\n    "rootDir": "src",\n    "types": ["node"]\n  },\n  "include": ["src/**/*.ts"],\n  "exclude": ["node_modules", "dist"]\n}\n',
      },
      {
        path: 'eslint.config.js',
        content:
          "import js from '@eslint/js'\nimport globals from 'globals'\nimport tseslint from 'typescript-eslint'\nimport prettier from 'eslint-config-prettier'\n\nexport default [\n  js.configs.recommended,\n  ...tseslint.configs.recommended,\n  {\n    files: ['**/*.ts'],\n    languageOptions: {\n      parserOptions: {\n        project: './tsconfig.json',\n        tsconfigRootDir: import.meta.dirname,\n      },\n      globals: {\n        ...globals.node,\n      },\n    },\n    rules: {\n      'no-console': 'off',\n    },\n  },\n  prettier,\n]\n",
      },
      {
        path: 'package.json',
        content:
          JSON.stringify(
            {
              name:
                String(name || 'node-express-api')
                  .toLowerCase()
                  .replace(/[^a-z0-9-_]/g, '-')
                  .replace(/-+/g, '-')
                  .replace(/^-|-$/g, '') || 'node-express-api',
              version: '1.0.0',
              private: true,
              type: 'module',
              engines: {
                node: '>=20.0.0',
              },
              scripts: {
                dev: 'tsx watch src/server.ts',
                build: 'tsc -p tsconfig.json',
                start: 'node dist/server.js',
                typecheck: 'tsc --noEmit',
                lint: 'eslint .',
                'lint:fix': 'eslint . --fix',
                format: 'prettier . --write',
                'format:check': 'prettier . --check',
              },
              dependencies: {
                cors: '^2.8.5',
                dotenv: '^16.4.7',
                express: '^4.21.2',
                helmet: '^8.0.0',
                morgan: '^1.10.0',
              },
              devDependencies: {
                '@eslint/js': '^9.17.0',
                '@types/cors': '^2.8.17',
                '@types/express': '^4.17.21',
                '@types/morgan': '^1.9.9',
                '@types/node': '^20.17.0',
                eslint: '^9.17.0',
                'eslint-config-prettier': '^9.1.0',
                globals: '^15.14.0',
                prettier: '^3.4.2',
                tsx: '^4.19.2',
                typescript: '^5.7.2',
                'typescript-eslint': '^8.18.2',
              },
            },
            null,
            2,
          ) + '\n',
      },
    )
  } else {
    commonFiles.push(
      {
        path: 'nodemon.json',
        content:
          '{\n  "watch": ["src"],\n  "ext": "js,json",\n  "ignore": ["node_modules", "coverage"],\n  "exec": "node src/server.js"\n}\n',
      },
      {
        path: 'eslint.config.js',
        content:
          "import js from '@eslint/js'\nimport globals from 'globals'\nimport prettier from 'eslint-config-prettier'\n\nexport default [\n  js.configs.recommended,\n  {\n    files: ['**/*.js'],\n    languageOptions: {\n      sourceType: 'module',\n      ecmaVersion: 'latest',\n      globals: {\n        ...globals.node,\n      },\n    },\n    rules: {\n      'no-console': 'off',\n    },\n  },\n  prettier,\n]\n",
      },
      {
        path: 'package.json',
        content:
          JSON.stringify(
            {
              name:
                String(name || 'node-express-api')
                  .toLowerCase()
                  .replace(/[^a-z0-9-_]/g, '-')
                  .replace(/-+/g, '-')
                  .replace(/^-|-$/g, '') || 'node-express-api',
              version: '1.0.0',
              private: true,
              type: 'module',
              engines: {
                node: '>=20.0.0',
              },
              scripts: {
                dev: 'nodemon',
                start: 'node src/server.js',
                lint: 'eslint .',
                'lint:fix': 'eslint . --fix',
                format: 'prettier . --write',
                'format:check': 'prettier . --check',
              },
              dependencies: {
                cors: '^2.8.5',
                dotenv: '^16.4.7',
                express: '^4.21.2',
                helmet: '^8.0.0',
                morgan: '^1.10.0',
              },
              devDependencies: {
                '@eslint/js': '^9.17.0',
                'eslint-config-prettier': '^9.1.0',
                globals: '^15.14.0',
                nodemon: '^3.1.9',
                prettier: '^3.4.2',
                eslint: '^9.17.0',
              },
            },
            null,
            2,
          ) + '\n',
      },
    )
  }

  return commonFiles
}

const VUE_VITE_JS_TEMPLATE_DIR = path.join(TEMPLATE_ROOT, 'vue-vite-js')
const VUE_VITE_TS_TEMPLATE_DIR = path.join(TEMPLATE_ROOT, 'vue-vite-ts')
const VUE_VITE_VARIANTS = [
  { id: 'javascript', label: 'JavaScript', defaultLanguage: 'javascript' },
  { id: 'typescript', label: 'TypeScript', defaultLanguage: 'typescript' },
]
const vueViteVariantMap = new Map(VUE_VITE_VARIANTS.map((variant) => [variant.id, variant]))

const sanitizePackageName = (name, fallback) =>
  String(name || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || fallback

const listTemplateFilesRecursively = (baseDir, prefix = '') => {
  const entries = fs.readdirSync(baseDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolutePath = path.join(baseDir, entry.name)

    if (entry.isDirectory()) {
      files.push(...listTemplateFilesRecursively(absolutePath, nextPrefix))
      continue
    }

    if (entry.isFile()) {
      files.push({ relativePath: nextPrefix, absolutePath })
    }
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

const buildVueViteFiles = ({ name, variantId }) => {
  const variant = vueViteVariantMap.get(variantId) || vueViteVariantMap.get('javascript')
  const packageName = sanitizePackageName(name, 'vue-app')
  const templateDir = variant.id === 'typescript' ? VUE_VITE_TS_TEMPLATE_DIR : VUE_VITE_JS_TEMPLATE_DIR
  const files = []

  for (const file of listTemplateFilesRecursively(templateDir)) {
    const relativePath = file.relativePath
    const mimeType = inferMimeFromPath(relativePath)
    const shouldUseBinary = /\.(ico|png|jpg|jpeg|gif|webp|bmp|avif)$/i.test(relativePath)

    if (shouldUseBinary && mimeType) {
      const buffer = fs.readFileSync(file.absolutePath)
      files.push({
        path: relativePath,
        binaryDataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
        sizeBytes: buffer.length,
      })
      continue
    }

    let content = fs.readFileSync(file.absolutePath, 'utf8')

    if (relativePath === 'package.json') {
      try {
        const parsed = JSON.parse(content)
        parsed.name = packageName
        content = `${JSON.stringify(parsed, null, 2)}\n`
      } catch (parseError) {
        void parseError
      }
    }

    if (relativePath === 'README.md') {
      content = content.replace(/^#\s+.+/m, `# ${name}`)
    }

    files.push({ path: relativePath, content })
  }

  return files
}

const PROJECT_TEMPLATES = {
  // Practice/DSA Templates (simple single-file)
  'practice-javascript': {
    id: 'practice-javascript',
    label: 'JavaScript',
    category: 'practice',
    defaultLanguage: 'javascript',
    files: () => [
      {
        path: 'main.js',
        content: "console.log('DC Editor')\n",
      },
    ],
  },
  'practice-python': {
    id: 'practice-python',
    label: 'Python',
    category: 'practice',
    defaultLanguage: 'python',
    files: () => [
      {
        path: 'main.py',
        content: "print('DC Editor')\n",
      },
    ],
  },
  'practice-typescript': {
    id: 'practice-typescript',
    label: 'TypeScript',
    category: 'practice',
    defaultLanguage: 'typescript',
    files: () => [
      {
        path: 'main.ts',
        content: "console.log('DC Editor')\n",
      },
    ],
  },
  'practice-cpp': {
    id: 'practice-cpp',
    label: 'C++',
    category: 'practice',
    defaultLanguage: 'cpp',
    files: () => [
      {
        path: 'main.cpp',
        content: '#include <iostream>\n\nint main() {\n    std::cout << "DC Editor" << std::endl;\n    return 0;\n}\n',
      },
    ],
  },
  'practice-java': {
    id: 'practice-java',
    label: 'Java',
    category: 'practice',
    defaultLanguage: 'java',
    files: () => [
      {
        path: 'Main.java',
        content: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("DC Editor");\n    }\n}\n',
      },
    ],
  },

  // Project Templates (full structure)
  'react-vite': {
    id: 'react-vite',
    label: 'React (Vite)',
    category: 'frontend',
    defaultLanguage: 'javascript',
    defaultVariantId: 'typescript',
    variants: REACT_VITE_VARIANTS,
    files: ({ name, variantId }) => buildReactViteVariantFiles({ name, variantId }),
  },
  'react-ts-tailwind': {
    id: 'react-ts-tailwind',
    label: 'React + TypeScript + Tailwind',
    hidden: true,
    category: 'frontend',
    defaultLanguage: 'typescript',
    files: ({ name }) => buildReactTsTailwindFiles({ name }),
  },
  'node-express': {
    id: 'node-express',
    label: 'Node.js + Express',
    category: 'backend',
    defaultLanguage: 'javascript',
    defaultVariantId: 'javascript',
    variants: NODE_EXPRESS_VARIANTS,
    files: ({ name, variantId }) => buildNodeExpressVariantFiles({ name, variantId }),
  },
  'nextjs-app': {
    id: 'nextjs-app',
    label: 'Next.js App',
    category: 'fullstack',
    defaultLanguage: 'typescript',
    files: ({ name }) => [
      {
        path: 'README.md',
        content:
          'This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).\n\n## Getting Started\n\nFirst, run the development server:\n\n```bash\nnpm run dev\n# or\nyarn dev\n# or\npnpm dev\n# or\nbun dev\n```\n\nOpen [http://localhost:3000](http://localhost:3000) with your browser to see the result.\n\nYou can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.\n\nThis project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.\n\n## Learn More\n\nTo learn more about Next.js, take a look at the following resources:\n\n- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.\n- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.\n\nYou can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!\n\n## Deploy on Vercel\n\nThe easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.\n\nCheck out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.\n',
      },
      {
        path: '.gitignore',
        content:
          '# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.\n\n# dependencies\n/node_modules\n/.pnp\n.pnp.*\n.yarn/*\n!.yarn/patches\n!.yarn/plugins\n!.yarn/releases\n!.yarn/versions\n\n# testing\n/coverage\n\n# next.js\n/.next/\n/out/\n\n# production\n/build\n\n# misc\n.DS_Store\n*.pem\n\n# debug\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\n.pnpm-debug.log*\n\n# env files (can opt-in for committing if needed)\n.env*\n\n# vercel\n.vercel\n\n# typescript\n*.tsbuildinfo\nnext-env.d.ts\n',
      },
      {
        path: 'app/favicon.ico',
        binaryDataUrl: NEXT_TEMPLATE_FAVICON_DATA_URL,
        sizeBytes: NEXT_TEMPLATE_FAVICON_SIZE_BYTES,
      },
      {
        path: 'app/globals.css',
        content:
          '@import "tailwindcss";\n\n:root {\n  --background: #ffffff;\n  --foreground: #171717;\n}\n\n@theme inline {\n  --color-background: var(--background);\n  --color-foreground: var(--foreground);\n  --font-sans: var(--font-geist-sans);\n  --font-mono: var(--font-geist-mono);\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n    --background: #0a0a0a;\n    --foreground: #ededed;\n  }\n}\n\nbody {\n  background: var(--background);\n  color: var(--foreground);\n  font-family: Arial, Helvetica, sans-serif;\n}\n',
      },
      {
        path: 'app/page.tsx',
        content:
          'import Image from "next/image";\n\nexport default function Home() {\n  return (\n    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">\n      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">\n        <Image\n          className="dark:invert"\n          src="/next.svg"\n          alt="Next.js logo"\n          width={100}\n          height={20}\n          priority\n        />\n        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">\n          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">\n            To get started, edit the page.tsx file.\n          </h1>\n          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">\n            Looking for a starting point or more instructions? Head over to{" "}\n            <a\n              href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"\n              className="font-medium text-zinc-950 dark:text-zinc-50"\n            >\n              Templates\n            </a>{" "}\n            or the{" "}\n            <a\n              href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"\n              className="font-medium text-zinc-950 dark:text-zinc-50"\n            >\n              Learning\n            </a>{" "}\n            center.\n          </p>\n        </div>\n        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">\n          <a\n            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] md:w-[158px]"\n            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"\n            target="_blank"\n            rel="noopener noreferrer"\n          >\n            <Image\n              className="dark:invert"\n              src="/vercel.svg"\n              alt="Vercel logomark"\n              width={16}\n              height={16}\n            />\n            Deploy Now\n          </a>\n          <a\n            className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-[158px]"\n            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"\n            target="_blank"\n            rel="noopener noreferrer"\n          >\n            Documentation\n          </a>\n        </div>\n      </main>\n    </div>\n  );\n}\n',
      },
      {
        path: 'app/layout.tsx',
        content:
          'import type { Metadata } from "next";\nimport { Geist, Geist_Mono } from "next/font/google";\nimport "./globals.css";\n\nconst geistSans = Geist({\n  variable: "--font-geist-sans",\n  subsets: ["latin"],\n});\n\nconst geistMono = Geist_Mono({\n  variable: "--font-geist-mono",\n  subsets: ["latin"],\n});\n\nexport const metadata: Metadata = {\n  title: "Create Next App",\n  description: "Generated by create next app",\n};\n\nexport default function RootLayout({\n  children,\n}: Readonly<{\n  children: React.ReactNode;\n}>) {\n  return (\n    <html\n      lang="en"\n      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}\n    >\n      <body className="min-h-full flex flex-col">{children}</body>\n    </html>\n  );\n}\n',
      },
      {
        path: 'public/file.svg',
        content:
          '<svg fill="none" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M14.5 13.5V5.41a1 1 0 0 0-.3-.7L9.8.29A1 1 0 0 0 9.08 0H1.5v13.5A2.5 2.5 0 0 0 4 16h8a2.5 2.5 0 0 0 2.5-2.5m-1.5 0v-7H8v-5H3v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1M9.5 5V2.12L12.38 5zM5.13 5h-.62v1.25h2.12V5zm-.62 3h7.12v1.25H4.5zm.62 3h-.62v1.25h7.12V11z" clip-rule="evenodd" fill="#666" fill-rule="evenodd"/></svg>',
      },
      {
        path: '.next/types/cache-life.d.ts',
        content: NEXT_TEMPLATE_CACHE_LIFE,
      },
      {
        path: '.next/types/routes.d.ts',
        content: NEXT_TEMPLATE_ROUTES,
      },
      {
        path: '.next/types/validator.ts',
        content: NEXT_TEMPLATE_VALIDATOR,
      },
      {
        path: 'public/globe.svg',
        content:
          '<svg fill="none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><g clip-path="url(#a)"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.27 14.1a6.5 6.5 0 0 0 3.67-3.45q-1.24.21-2.7.34-.31 1.83-.97 3.1M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m.48-1.52a7 7 0 0 1-.96 0H7.5a4 4 0 0 1-.84-1.32q-.38-.89-.63-2.08a40 40 0 0 0 3.92 0q-.25 1.2-.63 2.08a4 4 0 0 1-.84 1.31zm2.94-4.76q1.66-.15 2.95-.43a7 7 0 0 0 0-2.58q-1.3-.27-2.95-.43a18 18 0 0 1 0 3.44m-1.27-3.54a17 17 0 0 1 0 3.64 39 39 0 0 1-4.3 0 17 17 0 0 1 0-3.64 39 39 0 0 1 4.3 0m1.1-1.17q1.45.13 2.69.34a6.5 6.5 0 0 0-3.67-3.44q.65 1.26.98 3.1M8.48 1.5l.01.02q.41.37.84 1.31.38.89.63 2.08a40 40 0 0 0-3.92 0q.25-1.2.63-2.08a4 4 0 0 1 .85-1.32 7 7 0 0 1 .96 0m-2.75.4a6.5 6.5 0 0 0-3.67 3.44 29 29 0 0 1 2.7-.34q.31-1.83.97-3.1M4.58 6.28q-1.66.16-2.95.43a7 7 0 0 0 0 2.58q1.3.27 2.95.43a18 18 0 0 1 0-3.44m.17 4.71q-1.45-.12-2.69-.34a6.5 6.5 0 0 0 3.67 3.44q-.65-1.27-.98-3.1" fill="#666"/></g><defs><clipPath id="a"><path fill="#fff" d="M0 0h16v16H0z"/></clipPath></defs></svg>',
      },
      {
        path: 'public/next.svg',
        content:
          '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 394 80"><path fill="#000" d="M262 0h68.5v12.7h-27.2v66.6h-13.6V12.7H262V0ZM149 0v12.7H94v20.4h44.3v12.6H94v21h55v12.6H80.5V0h68.7zm34.3 0h-17.8l63.8 79.4h17.9l-32-39.7 32-39.6h-17.9l-23 28.6-23-28.6zm18.3 56.7-9-11-27.1 33.7h17.8l18.3-22.7z"/><path fill="#000" d="M81 79.3 17 0H0v79.3h13.6V17l50.2 62.3H81Zm252.6-.4c-1 0-1.8-.4-2.5-1s-1.1-1.6-1.1-2.6.3-1.8 1-2.5 1.6-1 2.6-1 1.8.3 2.5 1a3.4 3.4 0 0 1 .6 4.3 3.7 3.7 0 0 1-3 1.8zm23.2-33.5h6v23.3c0 2.1-.4 4-1.3 5.5a9.1 9.1 0 0 1-3.8 3.5c-1.6.8-3.5 1.3-5.7 1.3-2 0-3.7-.4-5.3-1s-2.8-1.8-3.7-3.2c-.9-1.3-1.4-3-1.4-5h6c.1.8.3 1.6.7 2.2s1 1.2 1.6 1.5c.7.4 1.5.5 2.4.5 1 0 1.8-.2 2.4-.6a4 4 0 0 0 1.6-1.8c.3-.8.5-1.8.5-3V45.5zm30.9 9.1a4.4 4.4 0 0 0-2-3.3 7.5 7.5 0 0 0-4.3-1.1c-1.3 0-2.4.2-3.3.5-.9.4-1.6 1-2 1.6a3.5 3.5 0 0 0-.3 4c.3.5.7.9 1.3 1.2l1.8 1 2 .5 3.2.8c1.3.3 2.5.7 3.7 1.2a13 13 0 0 1 3.2 1.8 8.1 8.1 0 0 1 3 6.5c0 2-.5 3.7-1.5 5.1a10 10 0 0 1-4.4 3.5c-1.8.8-4.1 1.2-6.8 1.2-2.6 0-4.9-.4-6.8-1.2-2-.8-3.4-2-4.5-3.5a10 10 0 0 1-1.7-5.6h6a5 5 0 0 0 3.5 4.6c1 .4 2.2.6 3.4.6 1.3 0 2.5-.2 3.5-.6 1-.4 1.8-1 2.4-1.7a4 4 0 0 0 .8-2.4c0-.9-.2-1.6-.7-2.2a11 11 0 0 0-2.1-1.4l-3.2-1-3.8-1c-2.8-.7-5-1.7-6.6-3.2a7.2 7.2 0 0 1-2.4-5.7 8 8 0 0 1 1.7-5 10 10 0 0 1 4.3-3.5c2-.8 4-1.2 6.4-1.2 2.3 0 4.4.4 6.2 1.2 1.8.8 3.2 2 4.3 3.4 1 1.4 1.5 3 1.5 5h-5.8z"/></svg>',
      },
      {
        path: 'public/vercel.svg',
        content: '<svg fill="none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1155 1000"><path d="m577.3 0 577.4 1000H0z" fill="#fff"/></svg>',
      },
      {
        path: 'public/window.svg',
        content:
          '<svg fill="none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M1.5 2.5h13v10a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1zM0 1h16v11.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 0 12.5zm3.75 4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5M7 4.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0m1.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5" fill="#666"/></svg>',
      },
      {
        path: 'eslint.config.mjs',
        content:
          'import { defineConfig, globalIgnores } from "eslint/config";\nimport nextVitals from "eslint-config-next/core-web-vitals";\nimport nextTs from "eslint-config-next/typescript";\n\nconst eslintConfig = defineConfig([\n  ...nextVitals,\n  ...nextTs,\n  // Override default ignores of eslint-config-next.\n  globalIgnores([\n    // Default ignores of eslint-config-next:\n    ".next/**",\n    "out/**",\n    "build/**",\n    "next-env.d.ts",\n  ]),\n]);\n\nexport default eslintConfig;\n',
      },
      {
        path: 'next-env.d.ts',
        content:
          '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\nimport "./.next/types/routes.d.ts";\n\n// NOTE: This file should not be edited\n// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.\n',
      },
      {
        path: 'next.config.ts',
        content:
          'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  turbopack: {\n    root: process.cwd(),\n  },\n  allowedDevOrigins: [\n    "localhost",\n    "127.0.0.1",\n    "192.168.1.4",\n  ],\n};\n\nexport default nextConfig;\n',
      },
      {
        path: 'postcss.config.mjs',
        content:
          'const config = {\n  plugins: {\n    "@tailwindcss/postcss": {},\n  },\n};\n\nexport default config;\n',
      },
      {
        path: 'tsconfig.json',
        content:
          '{\n  "compilerOptions": {\n    "target": "ES2017",\n    "lib": ["dom", "dom.iterable", "esnext"],\n    "allowJs": true,\n    "skipLibCheck": true,\n    "strict": true,\n    "noEmit": true,\n    "esModuleInterop": true,\n    "module": "esnext",\n    "moduleResolution": "bundler",\n    "resolveJsonModule": true,\n    "isolatedModules": true,\n    "jsx": "react-jsx",\n    "incremental": true,\n    "plugins": [\n      {\n        "name": "next"\n      }\n    ],\n    "paths": {\n      "@/*": ["./*"]\n    }\n  },\n  "include": [\n    "next-env.d.ts",\n    "**/*.ts",\n    "**/*.tsx",\n    ".next/types/**/*.ts",\n    ".next/dev/types/**/*.ts",\n    "**/*.mts"\n  ],\n  "exclude": ["node_modules"]\n}\n',
      },
      {
        path: 'package.json',
        content:
          JSON.stringify(
            {
              name:
                String(name || 'nextjs-app')
                  .toLowerCase()
                  .replace(/[^a-z0-9-_]/g, '-')
                  .replace(/-+/g, '-')
                  .replace(/^-|-$/g, '') || 'nextjs-app',
              version: '0.1.0',
              private: true,
              scripts: {
                dev: 'next dev',
                build: 'next build',
                start: 'next start',
                lint: 'eslint',
              },
              dependencies: {
                next: '16.1.6',
                react: '19.2.3',
                'react-dom': '19.2.3',
              },
              devDependencies: {
                '@tailwindcss/postcss': '^4',
                '@types/node': '^20',
                '@types/react': '^19',
                '@types/react-dom': '^19',
                eslint: '^9',
                'eslint-config-next': '16.1.6',
                tailwindcss: '^4',
                typescript: '^5',
              },
            },
            null,
            2,
          ) + '\n',
      },
    ],
  },
  'vue-vite': {
    id: 'vue-vite',
    label: 'Vue (Vite)',
    category: 'frontend',
    defaultLanguage: 'javascript',
    defaultVariantId: 'javascript',
    variants: VUE_VITE_VARIANTS,
    files: ({ name, variantId }) => buildVueViteFiles({ name, variantId }),
  },
  fastapi: {
    id: 'fastapi',
    label: 'FastAPI',
    category: 'backend',
    defaultLanguage: 'python',
    files: ({ name }) => [
      {
        path: 'README.md',
        content:
          `# ${name}\n\nFastAPI project with modular structure and simple startup options.\n\n## Run (No VS Code Required)\n\n### If you are using this web IDE terminal\n\nRun:\n\n.\\start.ps1\n\nIf script policy blocks it:\n\npowershell -ExecutionPolicy Bypass -File .\\start.ps1\n\nThen keep terminal running and open http://127.0.0.1:8000/docs in browser.\n\n### Local machine alternatives\n\n- Windows File Explorer: double-click start.bat\n- macOS/Linux terminal: chmod +x start.sh && ./start.sh\n\n## What startup scripts do\n\n- Use the project folder as working directory\n- Create .venv if missing\n- Install or update packages from requirements.txt\n- Copy .env.example to .env if .env is missing\n- Start FastAPI with uvicorn main:app --reload\n\nBy default, logs are quiet for users (clean output).\nSet FASTAPI_VERBOSE=1 before running script to show full pip + uvicorn logs.\n\n## Manual commands (optional)\n\nUse these only if you want to run each step manually (debugging/custom setup) instead of startup scripts.\n\nWindows (PowerShell/cmd):\n\npython -m venv .venv\n.\\.venv\\Scripts\\python.exe -m pip install -r requirements.txt\n.\\.venv\\Scripts\\python.exe -m uvicorn main:app --reload\n\nmacOS/Linux:\n\npython3 -m venv .venv\n./.venv/bin/python -m pip install -r requirements.txt\n./.venv/bin/python -m uvicorn main:app --reload\n\nDo not run ./.venv/bin/python on Windows. That path is only for macOS/Linux.\n\n## OS note for web IDE terminals\n\nThe terminal runs on the machine/container hosting this app, not on the browser user's device.\nSo command style should match the runtime OS of that terminal environment.\n\n## Important\n\nRunning .bat/.ps1/.sh prepares and runs the API locally on that machine.\nIt does not deploy to the public web automatically.\nFor internet users, deploy this backend to a hosting provider.\n\n## Endpoints\n\n- http://127.0.0.1:8000/\n- http://127.0.0.1:8000/api/health\n- http://127.0.0.1:8000/docs\n\n## Structure\n\n- app/main.py (application bootstrap)\n- api/routes/health.py (API router)\n- core/config.py (environment settings)\n- schemas/ping.py (response model)\n- main.py (entrypoint)\n`,
      },
      {
        path: '.gitignore',
        content: '__pycache__/\n*.py[cod]\n*.pyo\n*.pyd\n.venv/\n.env\n.pytest_cache/\n.vscode/*.log\n',
      },
      {
        path: '.env',
        content: 'APP_NAME=FastAPI App\nAPP_ENV=development\nAPP_DEBUG=true\nAPI_PREFIX=/api\n',
      },
      {
        path: '.env.example',
        content: 'APP_NAME=FastAPI App\nAPP_ENV=development\nAPP_DEBUG=true\nAPI_PREFIX=/api\n',
      },
      {
        path: 'requirements.txt',
        content: 'fastapi\nuvicorn[standard]\npydantic-settings\npython-dotenv\n',
      },
      {
        path: '__init__.py',
        content: '',
      },
      {
        path: 'app/__init__.py',
        content: '',
      },
      {
        path: 'app/main.py',
        content:
          "from fastapi import FastAPI\n\nfrom api.routes import health\nfrom core.config import get_settings\n\nsettings = get_settings()\n\napp = FastAPI(\n    title=settings.APP_NAME,\n    debug=settings.APP_DEBUG,\n)\n\napp.include_router(health.router, prefix=settings.API_PREFIX)\n\n\n@app.get('/')\ndef root() -> dict[str, str]:\n    return {'message': 'Hello World'}\n",
      },
      {
        path: 'api/__init__.py',
        content: '',
      },
      {
        path: 'api/routes/__init__.py',
        content: 'from .health import router\n\n__all__ = ["router"]\n',
      },
      {
        path: 'api/routes/health.py',
        content:
          "from fastapi import APIRouter\n\nfrom schemas.ping import PingResponse\n\nrouter = APIRouter(tags=['health'])\n\n\n@router.get('/health', response_model=PingResponse)\ndef health_check() -> PingResponse:\n    return PingResponse(status='ok', message='pong')\n",
      },
      {
        path: 'core/__init__.py',
        content: '',
      },
      {
        path: 'core/config.py',
        content:
          "from functools import lru_cache\n\nfrom pydantic_settings import BaseSettings, SettingsConfigDict\n\n\nclass Settings(BaseSettings):\n    APP_NAME: str = 'FastAPI App'\n    APP_ENV: str = 'development'\n    APP_DEBUG: bool = True\n    API_PREFIX: str = '/api'\n\n    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8')\n\n\n@lru_cache\ndef get_settings() -> Settings:\n    return Settings()\n",
      },
      {
        path: 'schemas/__init__.py',
        content: '',
      },
      {
        path: 'schemas/ping.py',
        content:
          "from pydantic import BaseModel\n\n\nclass PingResponse(BaseModel):\n    status: str\n    message: str\n",
      },
      {
        path: 'main.py',
        content: 'from app.main import app\n',
      },
      {
        path: 'scripts/setup.ps1',
        content:
          "$ErrorActionPreference = 'Stop'\n\npython -m venv .venv\n\n$pythonExe = '.\\.venv\\Scripts\\python.exe'\n$pipFlags = @('--disable-pip-version-check', '--no-input')\nif (-not $env:FASTAPI_VERBOSE) {\n  $pipFlags += '-q'\n}\n& $pythonExe -m pip install @pipFlags --upgrade pip\n& $pythonExe -m pip install @pipFlags -r requirements.txt\n\nif (-not (Test-Path '.env') -and (Test-Path '.env.example')) {\n  Copy-Item '.env.example' '.env'\n}\n\nWrite-Host 'FastAPI environment is ready.'\nWrite-Host 'Run: .\\.venv\\Scripts\\python.exe -m uvicorn main:app --reload'\nWrite-Host 'Optional: set FASTAPI_RELOAD=0 before start script to disable auto-reload.'\n",
      },
      {
        path: 'scripts/setup.sh',
        content:
          "#!/usr/bin/env bash\nset -euo pipefail\n\npython3 -m venv .venv\nPIP_FLAGS=(--disable-pip-version-check --no-input)\nif [ -z \"${FASTAPI_VERBOSE:-}\" ]; then\n  PIP_FLAGS+=(-q)\nfi\n./.venv/bin/python -m pip install \"${PIP_FLAGS[@]}\" --upgrade pip\n./.venv/bin/python -m pip install \"${PIP_FLAGS[@]}\" -r requirements.txt\n\nif [ ! -f .env ] && [ -f .env.example ]; then\n  cp .env.example .env\nfi\n\necho 'FastAPI environment is ready.'\necho 'Run: ./.venv/bin/python -m uvicorn main:app --reload'\necho 'Optional: set FASTAPI_RELOAD=0 before start script to disable auto-reload.'\n",
      },
      {
        path: 'start.bat',
        content:
        "@echo off\r\nsetlocal EnableDelayedExpansion\r\ncd /d \"%~dp0\"\r\n\r\necho [FastAPI] Starting setup...\r\n\r\nif not exist requirements.txt (\r\n  echo [FastAPI] requirements.txt not found in this folder.\r\n  pause\r\n  exit /b 1\r\n)\r\n\r\nif defined FASTAPI_VERBOSE (\r\n  set \"PIP_FLAGS=--disable-pip-version-check --no-input\"\r\n  set \"UVICORN_FLAGS=--log-level info\"\r\n) else (\r\n  set \"PIP_FLAGS=--disable-pip-version-check --no-input -q\"\r\n  set \"UVICORN_FLAGS=--log-level warning --no-access-log\"\r\n)\r\nset \"FASTAPI_RELOAD_VALUE=!FASTAPI_RELOAD!\"\r\nif /I not \"!FASTAPI_RELOAD_VALUE!\"==\"0\" if /I not \"!FASTAPI_RELOAD_VALUE!\"==\"false\" if /I not \"!FASTAPI_RELOAD_VALUE!\"==\"off\" if /I not \"!FASTAPI_RELOAD_VALUE!\"==\"no\" (\r\n  set \"UVICORN_FLAGS=!UVICORN_FLAGS! --reload\"\r\n)\r\n\r\nif not exist .venv\\Scripts\\python.exe (\r\n  echo [FastAPI] Creating virtual environment...\r\n  where py >nul 2>&1\r\n  if %ERRORLEVEL% EQU 0 (\r\n    py -3 -m venv .venv\r\n  ) else (\r\n    where python >nul 2>&1\r\n    if %ERRORLEVEL% NEQ 0 (\r\n      echo [FastAPI] Python not found. Install Python 3 and try again.\r\n      pause\r\n      exit /b 1\r\n    )\r\n    python -m venv .venv\r\n  )\r\n  if %ERRORLEVEL% NEQ 0 (\r\n    echo [FastAPI] Failed to create virtual environment.\r\n    pause\r\n    exit /b 1\r\n  )\r\n)\r\n\r\necho [FastAPI] Installing/updating dependencies...\r\n.\\.venv\\Scripts\\python.exe -m pip install %PIP_FLAGS% --upgrade pip\r\nif %ERRORLEVEL% NEQ 0 (\r\n  echo [FastAPI] Failed to upgrade pip.\r\n  pause\r\n  exit /b 1\r\n)\r\n\r\n.\\.venv\\Scripts\\python.exe -m pip install %PIP_FLAGS% -r requirements.txt\r\nif %ERRORLEVEL% NEQ 0 (\r\n  echo [FastAPI] Failed to install dependencies.\r\n  pause\r\n  exit /b 1\r\n)\r\n\r\nif not exist .env if exist .env.example copy .env.example .env >nul\r\n\r\nset \"APP_TARGET=%FASTAPI_APP%\"\r\nif not defined APP_TARGET if exist main.py set \"APP_TARGET=main:app\"\r\nif not defined APP_TARGET if exist app\\main.py set \"APP_TARGET=app.main:app\"\r\nif not defined APP_TARGET if exist src\\main.py set \"APP_TARGET=src.main:app\"\r\nif not defined APP_TARGET if exist app.py set \"APP_TARGET=app:app\"\r\nif not defined APP_TARGET set \"APP_TARGET=main:app\"\r\n\r\necho [FastAPI] Server running at http://127.0.0.1:8000 (!APP_TARGET!)\r\n.\\.venv\\Scripts\\python.exe -m uvicorn !APP_TARGET! %UVICORN_FLAGS%\r\nif %ERRORLEVEL% NEQ 0 (\r\n  echo [FastAPI] Server stopped with an error.\r\n  pause\r\n  exit /b 1\r\n)\r\n",
      },
      {
        path: 'start.ps1',
        content:
          "$ErrorActionPreference = 'Stop'\nSet-Location -Path $PSScriptRoot\n\nWrite-Host '[FastAPI] Starting setup...'\n\nif (-not (Test-Path 'requirements.txt')) {\n  throw '[FastAPI] requirements.txt not found in this folder.'\n}\n\nif (-not (Test-Path '.\\.venv\\Scripts\\python.exe')) {\n  Write-Host '[FastAPI] Creating virtual environment...'\n  if (Get-Command py -ErrorAction SilentlyContinue) {\n    & py -3 -m venv .venv\n  } elseif (Get-Command python -ErrorAction SilentlyContinue) {\n    & python -m venv .venv\n  } else {\n    throw '[FastAPI] Python not found. Install Python 3 and try again.'\n  }\n}\n\nWrite-Host '[FastAPI] Installing/updating dependencies...'\n$pythonExe = '.\\.venv\\Scripts\\python.exe'\n$pipFlags = @('--disable-pip-version-check', '--no-input')\n$uvicornFlags = @('--log-level', 'warning', '--no-access-log')\nif (-not $env:FASTAPI_VERBOSE) {\n  $pipFlags += '-q'\n} else {\n  $uvicornFlags = @('--log-level', 'info')\n}\n$reloadValue = [string]($env:FASTAPI_RELOAD ?? '')\n$reloadValue = $reloadValue.Trim().ToLowerInvariant()\nif ($reloadValue -notin @('0', 'false', 'off', 'no')) {\n  $uvicornFlags += '--reload'\n}\n& $pythonExe -m pip install @pipFlags --upgrade pip\n& $pythonExe -m pip install @pipFlags -r requirements.txt\n\nif (-not (Test-Path '.env') -and (Test-Path '.env.example')) {\n  Copy-Item '.env.example' '.env'\n}\n\n$appTarget = $env:FASTAPI_APP\nif (-not $appTarget) {\n  if (Test-Path 'main.py') {\n    $appTarget = 'main:app'\n  } elseif (Test-Path 'app\\main.py') {\n    $appTarget = 'app.main:app'\n  } elseif (Test-Path 'src\\main.py') {\n    $appTarget = 'src.main:app'\n  } elseif (Test-Path 'app.py') {\n    $appTarget = 'app:app'\n  } else {\n    $appTarget = 'main:app'\n  }\n}\n\nWrite-Host \"[FastAPI] Server running at http://127.0.0.1:8000 ($appTarget)\"\n& $pythonExe -m uvicorn $appTarget @uvicornFlags\n",
      },
      {
        path: 'start.sh',
        content:
            "#!/usr/bin/env bash\nset -euo pipefail\n\nSCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"\ncd \"$SCRIPT_DIR\"\n\nif [ ! -f requirements.txt ]; then\n  echo '[FastAPI] requirements.txt not found in this folder.'\n  exit 1\nfi\n\nif [ ! -f .venv/bin/python ]; then\n  echo '[FastAPI] Creating virtual environment...'\n  if command -v python3 >/dev/null 2>&1; then\n    python3 -m venv .venv\n  elif command -v python >/dev/null 2>&1; then\n    python -m venv .venv\n  else\n    echo '[FastAPI] Python not found. Install Python 3 and try again.'\n    exit 1\n  fi\nfi\n\necho '[FastAPI] Installing/updating dependencies...'\nPIP_FLAGS=(--disable-pip-version-check --no-input)\nUVICORN_FLAGS=(--log-level warning --no-access-log)\nif [ -z \"${FASTAPI_VERBOSE:-}\" ]; then\n  PIP_FLAGS+=(-q)\nelse\n  UVICORN_FLAGS=(--log-level info)\nfi\nRELOAD_VALUE=\"$(printf '%s' \"${FASTAPI_RELOAD:-}\" | tr '[:upper:]' '[:lower:]')\"\nif [ \"$RELOAD_VALUE\" != \"0\" ] && [ \"$RELOAD_VALUE\" != \"false\" ] && [ \"$RELOAD_VALUE\" != \"off\" ] && [ \"$RELOAD_VALUE\" != \"no\" ]; then\n  UVICORN_FLAGS+=(--reload)\nfi\n./.venv/bin/python -m pip install \"${PIP_FLAGS[@]}\" --upgrade pip\n./.venv/bin/python -m pip install \"${PIP_FLAGS[@]}\" -r requirements.txt\n\nif [ ! -f .env ] && [ -f .env.example ]; then\n  cp .env.example .env\nfi\n\nAPP_TARGET=\"${FASTAPI_APP:-}\"\nif [ -z \"$APP_TARGET\" ]; then\n  if [ -f main.py ]; then\n    APP_TARGET=\"main:app\"\n  elif [ -f app/main.py ]; then\n    APP_TARGET=\"app.main:app\"\n  elif [ -f src/main.py ]; then\n    APP_TARGET=\"src.main:app\"\n  elif [ -f app.py ]; then\n    APP_TARGET=\"app:app\"\n  else\n    APP_TARGET=\"main:app\"\n  fi\nfi\n\necho \"[FastAPI] Server running at http://127.0.0.1:8000 ($APP_TARGET)\"\n./.venv/bin/python -m uvicorn \"$APP_TARGET\" \"${UVICORN_FLAGS[@]}\"\n",
      },
      {
        path: '.vscode/launch.json',
        content:
          '{\n  "version": "0.2.0",\n  "configurations": [\n    {\n      "name": "Python Debugger: FastAPI",\n      "type": "debugpy",\n      "request": "launch",\n      "module": "uvicorn",\n      "args": [\n        "main:app",\n        "--reload"\n      ],\n      "jinja": true\n    }\n  ]\n}\n',
      },
      {
        path: '.vscode/extensions.json',
        content:
          '{\n  "recommendations": [\n    "ms-python.python",\n    "ms-python.vscode-pylance"\n  ]\n}\n',
      },
      {
        path: '.vscode/settings.json',
        content:
          '{\n  "python.defaultInterpreterPath": "${workspaceFolder}/.venv",\n  "python.terminal.activateEnvironment": false,\n  "python.testing.pytestEnabled": false,\n  "python.testing.unittestEnabled": false\n}\n',
      },
      {
        path: '.vscode/tasks.json',
        content:
          '{\n  "version": "2.0.0",\n  "tasks": [\n    {\n      "label": "FastAPI: Setup Environment",\n      "type": "shell",\n      "command": "python -m venv .venv && ./.venv/bin/python -m pip install --upgrade pip && ./.venv/bin/python -m pip install -r requirements.txt",\n      "windows": {\n        "command": "python -m venv .venv; .\\\\.venv\\\\Scripts\\\\python.exe -m pip install --upgrade pip; .\\\\.venv\\\\Scripts\\\\python.exe -m pip install -r requirements.txt"\n      },\n      "group": "build",\n      "problemMatcher": []\n    },\n    {\n      "label": "FastAPI: Run Dev Server",\n      "type": "shell",\n      "command": "./.venv/bin/python -m uvicorn main:app --reload",\n      "windows": {\n        "command": ".\\\\.venv\\\\Scripts\\\\python.exe -m uvicorn main:app --reload"\n      },\n      "isBackground": true,\n      "group": "test",\n      "problemMatcher": []\n    }\n  ]\n}\n',
      },
    ],
  },
  'python-cli': {
    id: 'python-cli',
    label: 'Python CLI',
    category: 'backend',
    defaultLanguage: 'python',
    files: ({ name }) => {
      const normalizedProjectName =
        String(name || 'python-cli-app')
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '') || 'python-cli-app'

      const packageName = normalizedProjectName.replace(/-/g, '_') || 'python_cli_app'

      return [
        {
          path: 'README.md',
          content:
            `# ${name}\n\nPython CLI starter aligned with standard VS Code workflows (venv, debugging, testing, linting, type-checking).\n\n## Requirements\n\n- Python 3.10+\n\n## How to run (simple)\n\nUse one common command:\n\n- PowerShell: ` + '`.\\start.ps1 <subcommand> [options]`' + `\n- CMD: ` + '`start.bat <subcommand> [options]`' + `\n- macOS/Linux: ` + '`./start.sh <subcommand> [options]`' + `\n\nExample:\n\n` + '```powershell' + `\n.\\start.ps1 greet --name Developer\n` + '```' + `\n\nFind available commands:\n\n` + '```powershell' + `\n.\\start.ps1 --help\n` + '```' + `\n\nShow help for one command:\n\n` + '```powershell' + `\n.\\start.ps1 greet --help\n` + '```' + `\n\n## Why commands look different\n\n- The script command (` + '`.\\start.ps1`' + ` / ` + '`start.bat`' + ` / ` + '`./start.sh`' + `) stays the same.\n- Only subcommand and options change (` + '`greet`' + `, ` + '`add`' + `, ` + '`list`' + `, etc.).\n- So this is still a one-entrypoint CLI project, not multiple unrelated run commands.\n\n## What startup scripts do\n\n- Create the .venv folder if missing\n- Install or update dependencies from requirements-dev.txt\n- Run the CLI module\n- Force UTF-8 output for safer Unicode printing on Windows terminals\n\n## Manual Quick Start\n\n1. Create virtual environment\n\n   ` + '```bash' + `\n   python -m venv .venv\n   ` + '```' + `\n\n2. Install project + dev tooling\n\n   ` + '```bash' + `\n   python -m pip install --upgrade pip\n   python -m pip install -r requirements-dev.txt\n   ` + '```' + `\n\n3. Run CLI\n\n   ` + '```bash' + `\n   python -m ${packageName}.main greet --name Developer\n   ` + '```' + `\n\n   or via generated command:\n\n   ` + '```bash' + `\n   ${normalizedProjectName} greet --name Developer\n   ` + '```' + `\n\n## Watch Mode (auto-rerun on changes)\n\n` + '```bash' + `\npython -m watchfiles --filter python "python -m ${packageName}.main greet --name Developer" src tests\n` + '```' + `\n\n## Quality Commands\n\n- ` + '`python -m pytest`' + ` run tests\n- ` + '`python -m ruff check .`' + ` lint code\n- ` + '`python -m ruff format .`' + ` format code\n- ` + '`python -m mypy src`' + ` basic type-check\n\n## VS Code\n\n- Recommended extensions are included in ` + '`.vscode/extensions.json`' + `.\n- Press ` + '`F5`' + ` and run ` + '`Python: CLI Module`' + ` to debug the CLI.\n- Tests are auto-discovered from ` + '`tests/`' + `.\n\n## Troubleshooting\n\n- If PowerShell blocks scripts:\n\n  ` + '```powershell' + `\n  powershell -ExecutionPolicy Bypass -File .\\start.ps1 --help\n  ` + '```' + `\n\n- If you see Unicode errors on Windows terminal, keep using startup scripts (they set UTF-8 mode).\n`,
        },
        {
          path: '.gitignore',
          content:
            '__pycache__/\n*.py[cod]\n*.pyo\n*.pyd\n.venv/\n.pytest_cache/\n.mypy_cache/\n.ruff_cache/\n.coverage\nhtmlcov/\ndist/\nbuild/\n*.egg-info/\n.env\n',
        },
        {
          path: 'pyproject.toml',
          content:
            `[build-system]\nrequires = ["setuptools>=68", "wheel"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "${normalizedProjectName}"\nversion = "0.1.0"\ndescription = "Python CLI starter"\nreadme = "README.md"\nrequires-python = ">=3.10"\ndependencies = []\n\n[project.optional-dependencies]\ndev = [\n  "pytest>=8.3.0",\n  "ruff>=0.6.9",\n  "mypy>=1.11.2",\n  "watchfiles>=0.24.0"\n]\n\n[project.scripts]\n${normalizedProjectName} = "${packageName}.main:main"\n\n[tool.setuptools]\npackage-dir = {"" = "src"}\n\n[tool.setuptools.packages.find]\nwhere = ["src"]\n\n[tool.pytest.ini_options]\npythonpath = ["src"]\ntestpaths = ["tests"]\n\n[tool.ruff]\nline-length = 100\ntarget-version = "py310"\n\n[tool.ruff.lint]\nselect = ["E", "F", "I", "UP", "B"]\n\n[tool.mypy]\npython_version = "3.10"\nstrict = false\nwarn_unused_ignores = true\nwarn_redundant_casts = true\nwarn_return_any = true\n`,
        },
        {
          path: 'requirements.txt',
          content: '-e .\n',
        },
        {
          path: 'requirements-dev.txt',
          content: '-e .[dev]\n',
        },
        {
          path: 'start.bat',
          content:
            `@echo off\r\nsetlocal EnableDelayedExpansion\r\ncd /d "%~dp0"\r\n\r\nchcp 65001 >nul\r\nset "PYTHONUTF8=1"\r\nset "PYTHONIOENCODING=utf-8"\r\n\r\nif not exist .venv\\Scripts\\python.exe (\r\n  python -m venv .venv\r\n  if %ERRORLEVEL% NEQ 0 exit /b 1\r\n)\r\n\r\n.\\.venv\\Scripts\\python.exe -m pip install --upgrade pip >nul\r\nif %ERRORLEVEL% NEQ 0 exit /b 1\r\n\r\n.\\.venv\\Scripts\\python.exe -m pip install -r requirements-dev.txt >nul\r\nif %ERRORLEVEL% NEQ 0 exit /b 1\r\n\r\nif "%~1"=="" (\r\n  .\\.venv\\Scripts\\python.exe -m ${packageName}.main --help\r\n) else (\r\n  .\\.venv\\Scripts\\python.exe -m ${packageName}.main %*\r\n)\r\nset "EXIT_CODE=%ERRORLEVEL%"\r\nexit /b %EXIT_CODE%\r\n`,
        },
        {
          path: 'start.ps1',
          content:
            `$ErrorActionPreference = 'Stop'\nSet-Location -Path $PSScriptRoot\n\n$utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n[Console]::OutputEncoding = $utf8NoBom\n[Console]::InputEncoding = $utf8NoBom\n$OutputEncoding = $utf8NoBom\n\n$env:PYTHONUTF8 = '1'\n$env:PYTHONIOENCODING = 'utf-8'\n\nif (-not (Test-Path '.\\.venv\\Scripts\\python.exe')) {\n  python -m venv .venv\n}\n\n$pythonExe = '.\\.venv\\Scripts\\python.exe'\n& $pythonExe -m pip install --upgrade pip | Out-Null\n& $pythonExe -m pip install -r requirements-dev.txt | Out-Null\n\nif ($args.Count -eq 0) {\n  & $pythonExe -m ${packageName}.main --help\n} else {\n  & $pythonExe -m ${packageName}.main @args\n}\n\n$exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }\nexit $exitCode\n`,
        },
        {
          path: 'start.sh',
          content:
            `#!/usr/bin/env bash\nset -euo pipefail\n\nSCRIPT_DIR="$(cd "$(dirname "${'${BASH_SOURCE[0]}'}")" && pwd)"\ncd "$SCRIPT_DIR"\n\nexport PYTHONUTF8=1\nexport PYTHONIOENCODING=utf-8\n\nif [ ! -f .venv/bin/python ]; then\n  python3 -m venv .venv\nfi\n\n./.venv/bin/python -m pip install --upgrade pip >/dev/null\n./.venv/bin/python -m pip install -r requirements-dev.txt >/dev/null\n\nif [ "$#" -eq 0 ]; then\n  ./.venv/bin/python -m ${packageName}.main --help\nelse\n  ./.venv/bin/python -m ${packageName}.main "$@"\nfi\nstatus=$?\nexit $status\n`,
        },
        {
          path: `src/${packageName}/__init__.py`,
          content: '__all__ = ["build_greeting"]\n__version__ = "0.1.0"\n',
        },
        {
          path: `src/${packageName}/app.py`,
          content:
            "from dataclasses import dataclass\n\n\n@dataclass(slots=True)\nclass GreetingResult:\n    message: str\n\n\ndef build_greeting(name: str, excited: bool = False) -> GreetingResult:\n    cleaned_name = (name or 'Developer').strip() or 'Developer'\n    suffix = '!' if excited else '.'\n    return GreetingResult(message=f'Hello, {cleaned_name}{suffix}')\n",
        },
        {
          path: `src/${packageName}/main.py`,
          content:
            "import argparse\n\nfrom .app import build_greeting\n\n\ndef build_parser() -> argparse.ArgumentParser:\n    parser = argparse.ArgumentParser(\n        description='Python CLI starter',\n        formatter_class=argparse.ArgumentDefaultsHelpFormatter,\n    )\n    subparsers = parser.add_subparsers(dest='command', required=True)\n\n    greet_parser = subparsers.add_parser('greet', help='print a greeting')\n    greet_parser.add_argument('--name', default='Developer', help='Name to greet')\n    greet_parser.add_argument('--excited', action='store_true', help='Add exclamation mark')\n\n    return parser\n\n\ndef main() -> int:\n    parser = build_parser()\n    args = parser.parse_args()\n\n    if args.command == 'greet':\n        result = build_greeting(args.name, excited=bool(args.excited))\n        print(result.message)\n        return 0\n\n    parser.print_help()\n    return 1\n\n\nif __name__ == '__main__':\n    raise SystemExit(main())\n",
        },
        {
          path: `src/${packageName}/__main__.py`,
          content: `from .main import main\n\nraise SystemExit(main())\n`,
        },
        {
          path: 'src/main.py',
          content: `from ${packageName}.main import main\n\nraise SystemExit(main())\n`,
        },
        {
          path: 'tests/test_app.py',
          content:
            `from ${packageName}.app import build_greeting\n\n\ndef test_build_greeting_default_name() -> None:\n    result = build_greeting('')\n    assert result.message == 'Hello, Developer.'\n\n\ndef test_build_greeting_excited() -> None:\n    result = build_greeting('Himanshu', excited=True)\n    assert result.message == 'Hello, Himanshu!'\n`,
        },
        {
          path: '.vscode/extensions.json',
          content:
            '{\n  "recommendations": [\n    "ms-python.python",\n    "ms-python.vscode-pylance",\n    "ms-python.debugpy",\n    "charliermarsh.ruff"\n  ]\n}\n',
        },
        {
          path: '.vscode/settings.json',
          content:
            '{\n  "python.terminal.activateEnvironment": true,\n  "python.testing.pytestEnabled": true,\n  "python.testing.pytestArgs": ["tests"],\n  "python.analysis.typeCheckingMode": "basic",\n  "editor.formatOnSave": true,\n  "[python]": {\n    "editor.defaultFormatter": "charliermarsh.ruff"\n  }\n}\n',
        },
        {
          path: '.vscode/launch.json',
          content:
            `{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: CLI Module",
      "type": "debugpy",
      "request": "launch",
      "module": "${packageName}.main",
      "args": ["greet", "--name", "Developer"],
      "console": "integratedTerminal",
      "justMyCode": true
    },
    {
      "name": "Python: Current File",
      "type": "debugpy",
      "request": "launch",
      "program": "${'$'}{file}",
      "console": "integratedTerminal",
      "justMyCode": true
    }
  ]
}
`,
        },
        {
          path: '.vscode/tasks.json',
          content:
            `{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Python: Setup venv + deps",
      "type": "shell",
      "command": "python3 -m venv .venv && ./.venv/bin/python -m pip install --upgrade pip && ./.venv/bin/python -m pip install -r requirements-dev.txt",
      "windows": {
        "command": "python -m venv .venv; .\\.venv\\Scripts\\python.exe -m pip install --upgrade pip; .\\.venv\\Scripts\\python.exe -m pip install -r requirements-dev.txt"
      },
      "problemMatcher": []
    },
    {
      "label": "Python: Run CLI",
      "type": "shell",
      "command": "./.venv/bin/python -m ${packageName}.main greet --name Developer",
      "windows": {
        "command": ".\\.venv\\Scripts\\python.exe -m ${packageName}.main greet --name Developer"
      },
      "group": "test",
      "problemMatcher": []
    },
    {
      "label": "Python: Test",
      "type": "shell",
      "command": "./.venv/bin/python -m pytest",
      "windows": {
        "command": ".\\.venv\\Scripts\\python.exe -m pytest"
      },
      "group": "test",
      "problemMatcher": []
    },
    {
      "label": "Python: Lint",
      "type": "shell",
      "command": "./.venv/bin/python -m ruff check .",
      "windows": {
        "command": ".\\.venv\\Scripts\\python.exe -m ruff check ."
      },
      "problemMatcher": []
    },
    {
      "label": "Python: Watch CLI",
      "type": "shell",
      "command": "./.venv/bin/python -m watchfiles --filter python "./.venv/bin/python -m ${packageName}.main greet --name Developer" src tests",
      "windows": {
        "command": ".\\.venv\\Scripts\\python.exe -m watchfiles --filter python ".\\.venv\\Scripts\\python.exe -m ${packageName}.main greet --name Developer" src tests"
      },
      "isBackground": true,
      "problemMatcher": []
    }
  ]
}
`,
        },
      ]
    },
  },
  'web-vanilla': {
    id: 'web-vanilla',
    label: 'HTML/CSS/JS',
    category: 'frontend',
    defaultLanguage: 'html',
    files: ({ name }) => [
      {
        path: 'README.md',
        content: `# ${name}\n\nSimple starter for HTML, CSS, and JavaScript.\n\n## Start\n\n1. Open \`index.html\`\n2. Edit \`styles.css\` and \`script.js\`\n3. Click the Live button in the editor to open preview\n\n## Structure\n\n- \`index.html\`\n- \`styles.css\`\n- \`script.js\`\n- \`assets/images/\` (store your images)\n`,
      },
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>My Interactive Page</title>\n    <link rel="stylesheet" href="./styles.css" />\n  </head>\n  <body>\n    <main class="container">\n      <h1>Interactive Starter</h1>\n      <p>Build your page by editing HTML, CSS, and JS files.</p>\n\n      <button id="counterBtn" type="button">Clicked: 0</button>\n    </main>\n\n    <script src="./script.js"></script>\n  </body>\n</html>\n',
      },
      {
        path: 'styles.css',
        content:
          'body {\n  margin: 0;\n  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;\n  background: #0b1220;\n  color: #e2e8f0;\n}\n\n.container {\n  width: min(760px, 92vw);\n  margin: 3rem auto;\n}\n\nh1 {\n  margin-top: 0;\n}\n\nbutton {\n  border: 0;\n  border-radius: 10px;\n  padding: 0.65rem 1rem;\n  background: #2563eb;\n  color: #fff;\n  cursor: pointer;\n}\n\nbutton:hover {\n  filter: brightness(1.06);\n}\n',
      },
      {
        path: 'script.js',
        content:
          "let count = 0\nconst counterBtn = document.getElementById('counterBtn')\n\nif (counterBtn) {\n  counterBtn.dataset.counterBound = 'true'\n  counterBtn.addEventListener('click', () => {\n    count += 1\n    counterBtn.textContent = `Clicked: ${count}`\n  })\n}\n",
      },
      {
        path: 'assets/images/README.md',
        content: 'Place your project images in this folder.\n',
      },
    ],
  },
  'typescript-node': {
    id: 'typescript-node',
    label: 'TypeScript Node',
    category: 'backend',
    defaultLanguage: 'typescript',
    files: ({ name }) => [
      {
        path: 'README.md',
        content:
          `# ${name}\n\nProduction-ready Node.js + TypeScript starter optimized for VS Code workflows.\n\n## Requirements\n\n- Node.js 20+\n\n## Quick Start\n\n1. Install dependencies\n\n   ` + '```bash' + `\n   npm install\n   ` + '```' + `\n\n2. Create environment file\n\n   ` + '```bash' + `\n   cp .env.example .env\n   ` + '```' + `\n\n3. Run in development mode\n\n   ` + '```bash' + `\n   npm run dev\n   ` + '```' + `\n\n4. Open in browser\n\n   - http://localhost:3000/\n   - http://localhost:3000/health\n\n## Scripts\n\n- ` + '`npm run dev`' + ` start watch mode with tsx\n- ` + '`npm run build`' + ` compile TypeScript to dist\n- ` + '`npm run typecheck`' + ` run TypeScript checks\n- ` + '`npm start`' + ` run compiled app from dist\n\n## VS Code\n\n- Press ` + '`F5`' + ` and choose one of:\n  - ` + '`Debug TypeScript (tsx)`' + ` for direct TS debugging\n  - ` + '`Debug built app`' + ` to debug compiled output with source maps\n`,
      },
      {
        path: '.gitignore',
        content: 'node_modules\ndist\n.env\n*.tsbuildinfo\n',
      },
      {
        path: '.env.example',
        content: 'NODE_ENV=development\nPORT=3000\nAPP_NAME=ts-node-app\n',
      },
      {
        path: 'src/config/env.ts',
        content:
          "import 'dotenv/config'\n\nexport type NodeEnv = 'development' | 'test' | 'production'\n\nconst parsePort = (value: string | undefined, fallback = 3000): number => {\n  const parsed = Number(value)\n  if (!Number.isInteger(parsed)) return fallback\n  if (parsed < 1 || parsed > 65535) return fallback\n  return parsed\n}\n\nconst parseNodeEnv = (value: string | undefined): NodeEnv => {\n  if (value === 'test' || value === 'production') return value\n  return 'development'\n}\n\nexport const env = {\n  NODE_ENV: parseNodeEnv(process.env.NODE_ENV),\n  PORT: parsePort(process.env.PORT, 3000),\n  APP_NAME: process.env.APP_NAME || 'ts-node-app',\n}\n",
      },
      {
        path: 'src/lib/logger.ts',
        content:
          "export const logInfo = (message: string): void => {\n  const now = new Date().toISOString()\n  console.log(`[${now}] INFO: ${message}`)\n}\n",
      },
      {
        path: 'src/index.ts',
        content:
          "import { createServer } from 'node:http'\nimport { env } from './config/env.js'\nimport { logInfo } from './lib/logger.js'\n\nconst requestListener = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void => {\n  const method = req.method || 'GET'\n  const url = req.url || '/'\n\n  if (method === 'GET' && url === '/health') {\n    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })\n    res.end(JSON.stringify({ ok: true, service: env.APP_NAME, env: env.NODE_ENV, timestamp: new Date().toISOString() }))\n    return\n  }\n\n  if (method === 'GET' && url === '/') {\n    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })\n    res.end(JSON.stringify({ ok: true, message: `${env.APP_NAME} is running`, docs: ['/health'] }))\n    return\n  }\n\n  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })\n  res.end(JSON.stringify({ ok: false, message: `Route not found: ${method} ${url}` }))\n}\n\nconst server = createServer(requestListener)\n\nserver.listen(env.PORT, '0.0.0.0', () => {\n  logInfo(`Starting ${env.APP_NAME} in ${env.NODE_ENV} mode`)\n  logInfo(`Server running on http://localhost:${env.PORT}`)\n})\n\nconst shutdown = (signal: NodeJS.Signals): void => {\n  logInfo(`${signal} received, shutting down...`)\n  server.close((error) => {\n    if (error) {\n      console.error(error)\n      process.exit(1)\n    }\n    process.exit(0)\n  })\n}\n\nprocess.on('SIGINT', () => shutdown('SIGINT'))\nprocess.on('SIGTERM', () => shutdown('SIGTERM'))\n",
      },
      {
        path: '.vscode/extensions.json',
        content:
          '{\n  "recommendations": [\n    "ms-vscode.vscode-typescript-next",\n    "ms-vscode.js-debug-nightly"\n  ]\n}\n',
      },
      {
        path: '.vscode/settings.json',
        content:
          '{\n  "typescript.tsdk": "node_modules/typescript/lib"\n}\n',
      },
      {
        path: '.vscode/tasks.json',
        content:
          '{\n  "version": "2.0.0",\n  "tasks": [\n    {\n      "type": "npm",\n      "script": "build",\n      "label": "npm: build",\n      "group": {\n        "kind": "build",\n        "isDefault": true\n      },\n      "problemMatcher": ["$tsc"]\n    }\n  ]\n}\n',
      },
      {
        path: '.vscode/launch.json',
        content:
          '{\n  "version": "0.2.0",\n  "configurations": [\n    {\n      "type": "node",\n      "request": "launch",\n      "name": "Debug TypeScript (tsx)",\n      "runtimeExecutable": "npx",\n      "runtimeArgs": ["tsx", "src/index.ts"],\n      "cwd": "${workspaceFolder}",\n      "console": "integratedTerminal",\n      "skipFiles": ["<node_internals>/**"]\n    },\n    {\n      "type": "node",\n      "request": "launch",\n      "name": "Debug built app",\n      "program": "${workspaceFolder}/dist/index.js",\n      "preLaunchTask": "npm: build",\n      "outFiles": ["${workspaceFolder}/dist/**/*.js"],\n      "skipFiles": ["<node_internals>/**"]\n    }\n  ]\n}\n',
      },
      {
        path: 'tsconfig.json',
        content:
          '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "NodeNext",\n    "moduleResolution": "NodeNext",\n    "lib": ["ES2022"],\n    "strict": true,\n    "esModuleInterop": true,\n    "forceConsistentCasingInFileNames": true,\n    "skipLibCheck": true,\n    "resolveJsonModule": true,\n    "sourceMap": true,\n    "declaration": true,\n    "declarationMap": true,\n    "types": ["node"],\n    "noEmitOnError": true,\n    "outDir": "dist",\n    "rootDir": "src"\n  },\n  "include": ["src/**/*.ts"],\n  "exclude": ["node_modules", "dist"]\n}\n',
      },
      {
        path: 'package.json',
        content:
          JSON.stringify(
            {
              name:
                String(name || 'ts-node-app')
                  .toLowerCase()
                  .replace(/[^a-z0-9-_]/g, '-')
                  .replace(/-+/g, '-')
                  .replace(/^-|-$/g, '') || 'ts-node-app',
              private: true,
              type: 'module',
              engines: {
                node: '>=20.0.0',
              },
              scripts: {
                dev: 'tsx watch --clear-screen=false src/index.ts',
                build: 'tsc -p tsconfig.json',
                typecheck: 'tsc --noEmit',
                start: 'node dist/index.js',
              },
              dependencies: {
                dotenv: '^16.4.7',
              },
              devDependencies: {
                typescript: '^5.6.3',
                tsx: '^4.19.2',
                '@types/node': '^20.17.0',
              },
            },
            null,
            2,
          ) + '\n',
      },
    ],
  },
}

const LEGACY_LANGUAGE_TO_TEMPLATE = {
  javascript: 'react-vite',
  typescript: 'typescript-node',
  html: 'web-vanilla',
  css: 'web-vanilla',
  python: 'python-cli',
}

const getTemplate = (templateIdOrLanguage) => {
  const normalized = String(templateIdOrLanguage || '').trim()
  if (PROJECT_TEMPLATES[normalized]) {
    return PROJECT_TEMPLATES[normalized]
  }
  const fromLegacy = LEGACY_LANGUAGE_TO_TEMPLATE[normalized]
  if (fromLegacy && PROJECT_TEMPLATES[fromLegacy]) {
    return PROJECT_TEMPLATES[fromLegacy]
  }
  return PROJECT_TEMPLATES['react-vite']
}

const getTemplateVariant = (template, variantId) => {
  const variants = Array.isArray(template?.variants) ? template.variants : []
  if (!variants.length) return null

  const byId = variants.find((variant) => variant.id === variantId)
  if (byId) return byId

  const fallback = variants.find((variant) => variant.id === template.defaultVariantId)
  return fallback || variants[0]
}

const resolveTemplateVariantId = (templateId, templateVariantId, language) => {
  const template = getTemplate(templateId)
  const variants = Array.isArray(template?.variants) ? template.variants : []
  if (!variants.length) return null

  const explicitVariantId = String(templateVariantId || '').trim()
  if (explicitVariantId) {
    const explicit = variants.find((variant) => variant.id === explicitVariantId)
    if (explicit) return explicit.id
  }

  const normalizedLanguage = String(language || '').trim().toLowerCase()
  if (normalizedLanguage) {
    const byLanguage = variants.find(
      (variant) => String(variant.defaultLanguage || '').trim().toLowerCase() === normalizedLanguage,
    )
    if (byLanguage) return byLanguage.id
  }

  const fallback = variants.find((variant) => variant.id === template.defaultVariantId)
  return (fallback || variants[0] || null)?.id || null
}

const inferProjectTypeFromTemplate = (templateId) => {
  const template = getTemplate(templateId)
  return template?.category === 'practice' ? 'practice' : 'project'
}

const TEMPLATE_DESCRIPTIONS = {
  'practice-javascript': 'Single-file JavaScript runner for DSA/practice problems.',
  'practice-python': 'Single-file Python runner for DSA/practice problems.',
  'practice-typescript': 'Single-file TypeScript runner for DSA/practice problems.',
  'practice-cpp': 'Single-file C++ runner for DSA/practice problems.',
  'practice-java': 'Single-file Java runner for DSA/practice problems.',
  'react-vite': 'Frontend app with Vite + React and selectable variants.',
  'node-express': 'Backend API starter with Express and JavaScript/TypeScript variants.',
  'vue-vite': 'Frontend app with Vue + Vite and JavaScript/TypeScript variants.',
  'typescript-node': 'Production-style Node.js TypeScript backend starter.',
  'python-cli': 'CLI-focused Python project with packaging and VS Code tooling.',
  fastapi: 'FastAPI backend starter with virtualenv scripts and API docs route.',
  'nextjs-app': 'Next.js fullstack app scaffold with app router and TypeScript.',
}

const TEMPLATE_VARIANT_DESCRIPTIONS = {
  'react-vite': {
    typescript: 'React (Vite) with TypeScript baseline setup.',
    'typescript-tailwind': 'React (Vite) + TypeScript + Tailwind CSS v4 ready to use.',
    'typescript-react-compiler': 'TypeScript variant with React Compiler plugin enabled.',
    'typescript-swc': 'TypeScript variant using SWC React plugin for speed.',
    javascript: 'React (Vite) with JavaScript baseline setup.',
    'javascript-react-compiler': 'JavaScript variant with React Compiler plugin enabled.',
    'javascript-swc': 'JavaScript variant using SWC React plugin for speed.',
  },
  'node-express': {
    javascript: 'Express server in JavaScript with common middleware and scripts.',
    typescript: 'Express server in TypeScript with build and typecheck workflow.',
  },
  'vue-vite': {
    javascript: 'Vue + Vite JavaScript starter.',
    typescript: 'Vue + Vite TypeScript starter.',
  },
}

const getTemplateDescription = (templateId) => TEMPLATE_DESCRIPTIONS[String(templateId || '').trim()] || ''

const getTemplateVariantDescription = (templateId, variantId) => {
  const templateKey = String(templateId || '').trim()
  const variantKey = String(variantId || '').trim()
  if (!templateKey || !variantKey) return ''
  return TEMPLATE_VARIANT_DESCRIPTIONS?.[templateKey]?.[variantKey] || ''
}

const runtimeForExtension = (path) => {
  const normalized = normalizePath(path)
  const ext = normalized.split('.').pop()?.toLowerCase()
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'javascript'
  if (ext === 'py') return 'python'
  if (ext === 'cpp' || ext === 'cc' || ext === 'cxx') return 'cpp'
  if (ext === 'java') return 'java'
  if (ext === 'ts') return 'typescript'
  return null
}

const normalizePracticeLanguage = (language) => {
  const normalized = String(language || '').trim().toLowerCase()
  if (normalized === 'c++') return 'cpp'
  if (normalized === 'js') return 'javascript'
  if (normalized === 'ts') return 'typescript'
  return normalized
}

const isPracticeRuntimeAllowed = (projectLanguage, runtime) => {
  const expected = normalizePracticeLanguage(projectLanguage)
  const actual = normalizePracticeLanguage(runtime)
  if (!expected || !actual) return false
  return expected === actual
}

const isPracticePathAllowed = (project, filePath) => {
  if (project?.projectType !== 'practice') return true
  const runtime = runtimeForExtension(filePath)
  if (!runtime) return false
  return isPracticeRuntimeAllowed(project?.language, runtime)
}

const EXECUTION_CPU_LIMIT = String(process.env.DSA_EXECUTION_CPUS || '1.5').trim()
const EXECUTION_MEMORY_LIMIT = String(process.env.DSA_EXECUTION_MEMORY || '1024m').trim()
const EXECUTION_TIMEOUT_MS = Math.max(2000, Number(process.env.DSA_EXECUTION_TIMEOUT_MS || 20000))
const EXECUTION_STDIN_MAX_BYTES = Math.max(1024, Number(process.env.DSA_STDIN_MAX_BYTES || 262144))
const TS_NODE_COMPILER_OPTIONS_JSON = '{"module":"CommonJS","moduleResolution":"node"}'
const DSA_TYPESCRIPT_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2020',
      module: 'CommonJS',
      moduleResolution: 'node',
      esModuleInterop: true,
      skipLibCheck: true,
      strict: false,
    },
  },
  null,
  2,
) + '\n'
const DSA_RUNTIME_TMP_ROOT = path.join(os.tmpdir(), 'dc-editor-dsa-runtime')

const ensureDsaRuntimeTempRoot = () => {
  if (!fs.existsSync(DSA_RUNTIME_TMP_ROOT)) {
    fs.mkdirSync(DSA_RUNTIME_TMP_ROOT, { recursive: true })
  }
}

const makeDsaRuntimeTempPath = (name) => {
  ensureDsaRuntimeTempRoot()
  return path.join(DSA_RUNTIME_TMP_ROOT, name)
}

const runProcess = ({ command, args, input, timeoutMs = EXECUTION_TIMEOUT_MS }) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'pipe', shell: false })
    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL')
        }
      }, 250)
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        exitCode: null,
        timedOut: false,
        stdout,
        stderr: `${stderr}${error.message}`,
      })
    })

    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({
        ok: !timedOut && exitCode === 0,
        exitCode,
        timedOut,
        stdout,
        stderr,
      })
    })

    if (input) {
      child.stdin.write(input)
    }
    child.stdin.end()
  })

const runDockerCode = async (runtime, sourceCode, stdinInput = '') => {
  const tempDir = makeDsaRuntimeTempPath(`.temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
  
  try {
    // Create temp directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    let sourceFile = 'main.js'
    let runCommand = 'node /tmp/code/main.js'

    if (runtime === 'cpp') {
      sourceFile = 'main.cpp'
      runCommand = 'cd /tmp/code && g++ -std=c++20 -O2 -pipe main.cpp -o main && ./main'
    } else if (runtime === 'java') {
      sourceFile = 'Main.java'
      runCommand = 'cd /tmp/code && javac -encoding UTF-8 -Xlint:none -nowarn Main.java && java Main'
    } else if (runtime === 'python') {
      sourceFile = 'main.py'
      runCommand = 'python3 -u /tmp/code/main.py'
    } else if (runtime === 'typescript') {
      sourceFile = 'main.ts'
      runCommand = 'cd /tmp/code && ts-node --transpile-only --project tsconfig.json main.ts'
    }

    // Write source code to temp file
    fs.writeFileSync(path.join(tempDir, sourceFile), sourceCode)
    if (runtime === 'typescript') {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), DSA_TYPESCRIPT_TSCONFIG)
    }

    // Run in Docker
    const result = await runProcess({
      command: 'docker',
      args: [
        'run',
        '--rm',
        '-i',
        `-v`,
        `${tempDir}:/tmp/code`,
        '--cpus',
        EXECUTION_CPU_LIMIT,
        '--memory',
        EXECUTION_MEMORY_LIMIT,
        '--read-only',
        '--network=none',
        '--cap-drop=ALL',
        'code-executor:latest',
        'bash',
        '-lc',
        runCommand,
      ],
      input: stdinInput,
      timeoutMs: EXECUTION_TIMEOUT_MS,
    })

    return result
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: `Docker execution error: ${error.message}`,
    }
  } finally {
    // Cleanup temp directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    } catch (cleanupError) {
      void cleanupError
    }
  }
}

const runCode = async (runtime, sourceCode, stdinInput = '') => {
  // Try Docker first if enabled and available
  if (USE_DOCKER) {
    try {
      return await runDockerCode(runtime, sourceCode, stdinInput)
    } catch (error) {
      console.error('Docker execution failed, falling back to native:', error.message)
      // Fall through to native execution
    }
  }

  // Native execution fallback
  if (runtime === 'javascript') {
    return runProcess({
      command: 'node',
      args: ['--input-type=module', '-'],
      input: sourceCode,
      timeoutMs: EXECUTION_TIMEOUT_MS,
    })
  }

  if (runtime === 'python') {
    const pythonResult = await runProcess({ command: 'python', args: ['-'], input: sourceCode, timeoutMs: EXECUTION_TIMEOUT_MS })
    if (pythonResult.stderr.includes('not recognized') || pythonResult.stderr.includes('ENOENT')) {
      return runProcess({ command: 'py', args: ['-3', '-'], input: sourceCode, timeoutMs: EXECUTION_TIMEOUT_MS })
    }
    return pythonResult
  }

  if (runtime === 'cpp') {
    // Write source to temp file
    const fs = await import('fs')
    ensureDsaRuntimeTempRoot()
    const tempFile = path.join(DSA_RUNTIME_TMP_ROOT, `temp_${Date.now()}.cpp`)
    const outputFile = path.join(DSA_RUNTIME_TMP_ROOT, `temp_output_${Date.now()}`)
    
    try {
      fs.writeFileSync(tempFile, sourceCode)

      // Try g++ first
      let compileResult = await runProcess({
        command: 'g++',
        args: ['-std=c++20', '-O2', '-pipe', tempFile, '-o', outputFile],
        timeoutMs: Math.max(10000, EXECUTION_TIMEOUT_MS),
      })

      if (compileResult.stderr.includes('not recognized') || compileResult.stderr.includes('ENOENT')) {
        // Try clang++ if g++ not found
        compileResult = await runProcess({
          command: 'clang++',
          args: ['-std=c++20', '-O2', '-pipe', tempFile, '-o', outputFile],
          timeoutMs: Math.max(10000, EXECUTION_TIMEOUT_MS),
        })
        
        if (compileResult.stderr.includes('not recognized') || compileResult.stderr.includes('ENOENT')) {
          fs.unlinkSync(tempFile)
          return {
            ok: false,
            exitCode: 1,
            timedOut: false,
            stdout: '',
            stderr: 'C++ compiler not found. Please install g++ or clang++.\nWindows: Install MinGW or Visual Studio\nMac: Install Xcode Command Line Tools\nLinux: sudo apt install g++',
          }
        }
      }

      if (!compileResult.ok) {
        fs.unlinkSync(tempFile)
        return {
          ok: false,
          exitCode: compileResult.exitCode,
          timedOut: compileResult.timedOut,
          stdout: compileResult.stdout,
          stderr: `Compilation failed:\n${compileResult.stderr}`,
        }
      }

      // Run the compiled executable
      const exePath = process.platform === 'win32' ? `${outputFile}.exe` : outputFile
      const runResult = await runProcess({
        command: exePath,
        args: [],
        input: stdinInput,
        timeoutMs: EXECUTION_TIMEOUT_MS,
      })

      // Cleanup
      try {
        fs.unlinkSync(tempFile)
        if (fs.existsSync(exePath)) fs.unlinkSync(exePath)
      } catch (cleanupError) {
        void cleanupError
      }

      return runResult
    } catch (error) {
      // Cleanup on error
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
      } catch (cleanupError) {
        void cleanupError
      }
      return {
        ok: false,
        exitCode: 1,
        timedOut: false,
        stdout: '',
        stderr: `C++ execution error: ${error.message}`,
      }
    }
  }

  if (runtime === 'java') {
    // Extract class name from source code
    const classNameMatch = sourceCode.match(/public\s+class\s+(\w+)/)
    const className = classNameMatch ? classNameMatch[1] : 'Main'

    // Write source to temp file
    const fs = await import('fs')
    const path = await import('path')
    const tempDir = makeDsaRuntimeTempPath(`java_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    fs.mkdirSync(tempDir, { recursive: true })
    const javaFile = path.join(tempDir, `${className}.java`)

    try {
      fs.writeFileSync(javaFile, sourceCode)

      // Compile Java code
      const compileResult = await runProcess({
        command: 'javac',
        args: [javaFile],
        timeoutMs: Math.max(10000, EXECUTION_TIMEOUT_MS),
      })

      if (compileResult.stderr.includes('not recognized') || compileResult.stderr.includes('ENOENT')) {
        fs.unlinkSync(javaFile)
        return {
          ok: false,
          exitCode: 1,
          timedOut: false,
          stdout: '',
          stderr: 'Java compiler (javac) not found. Please install JDK.\nDownload from: https://www.oracle.com/java/technologies/downloads/',
        }
      }

      if (!compileResult.ok) {
        fs.unlinkSync(javaFile)
        return {
          ok: false,
          exitCode: compileResult.exitCode,
          timedOut: compileResult.timedOut,
          stdout: compileResult.stdout,
          stderr: `Compilation failed:\n${compileResult.stderr}`,
        }
      }

      // Run Java class
      const runResult = await runProcess({
        command: 'java',
        args: ['-cp', tempDir, className],
        input: stdinInput,
        timeoutMs: EXECUTION_TIMEOUT_MS,
      })

      // Cleanup
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        void cleanupError
      }

      return runResult
    } catch (error) {
      // Cleanup on error
      try {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        void cleanupError
      }
      return {
        ok: false,
        exitCode: 1,
        timedOut: false,
        stdout: '',
        stderr: `Java execution error: ${error.message}`,
      }
    }
  }

  if (runtime === 'typescript') {
    // Try ts-node first
    const tsNodeResult = await runProcess({
      command: 'ts-node',
      args: ['--transpile-only', '--compiler-options', TS_NODE_COMPILER_OPTIONS_JSON, '-e', sourceCode],
      timeoutMs: EXECUTION_TIMEOUT_MS,
    })

    if (tsNodeResult.stderr.includes('not recognized') || tsNodeResult.stderr.includes('ENOENT')) {
      // Fallback: try running with node (will fail but give better error)
      return {
        ok: false,
        exitCode: 1,
        timedOut: false,
        stdout: '',
        stderr: 'TypeScript execution requires ts-node.\nInstall it: npm install -g ts-node typescript\nOr convert your code to JavaScript.',
      }
    }

    return tsNodeResult
  }

  return {
    ok: false,
    exitCode: null,
    timedOut: false,
    stdout: '',
    stderr: `Unsupported runtime: ${runtime}. Supported: JavaScript (.js), Python (.py), C++ (.cpp), Java (.java), TypeScript (.ts)`,
  }
}

// Interactive code execution with real-time I/O (for WebSocket)
const runCodeInteractive = async (
  runtime,
  sourceCode,
  onOutput,
  onWaitingInput,
  onFinished,
  onError,
) => {
  let child = null
  let tempFile = null
  const fs = await import('fs')

  const cleanupTempFile = () => {
    if (tempFile) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile)
        }
      } catch (cleanupError) {
        void cleanupError
      }
    }
  }

  try {
    // Determine command and args based on runtime
    let command, args
    const runInDocker = USE_DOCKER

    if (runtime === 'javascript') {
      tempFile = makeDsaRuntimeTempPath(`temp_${Date.now()}.js`)
      fs.writeFileSync(tempFile, sourceCode)

      if (runInDocker) {
        const dockerPath = tempFile.replace(/\\/g, '/')
        command = 'docker'
        args = [
          'run',
          '--rm',
          '-i',
          '--cpus',
          EXECUTION_CPU_LIMIT,
          '--memory',
          EXECUTION_MEMORY_LIMIT,
          '--network=none',
          '--cap-drop=ALL',
          '-v',
          `${dockerPath}:/tmp/main.js`,
          'code-executor:latest',
          '/bin/bash',
          '-lc',
          'stdbuf -o0 -e0 node /tmp/main.js',
        ]
      } else {
        command = 'node'
        args = [tempFile]
      }
    } else if (runtime === 'python') {
      tempFile = makeDsaRuntimeTempPath(`temp_${Date.now()}.py`)
      fs.writeFileSync(tempFile, sourceCode)

      if (runInDocker) {
        const dockerPath = tempFile.replace(/\\/g, '/')
        command = 'docker'
        args = [
          'run',
          '--rm',
          '-i',
          '--cpus',
          EXECUTION_CPU_LIMIT,
          '--memory',
          EXECUTION_MEMORY_LIMIT,
          '--network=none',
          '--cap-drop=ALL',
          '-v',
          `${dockerPath}:/tmp/main.py`,
          'code-executor:latest',
          '/bin/bash',
          '-lc',
          'python3 -u /tmp/main.py',
        ]
      } else {
        command = 'python'
        args = ['-u', tempFile]
      }
    } else if (runtime === 'typescript') {
      if (runInDocker) {
        tempFile = makeDsaRuntimeTempPath(`temp_${Date.now()}.ts`)
        fs.writeFileSync(tempFile, sourceCode)
        const dockerPath = tempFile.replace(/\\/g, '/')
        command = 'docker'
        args = [
          'run',
          '--rm',
          '-i',
          '--cpus',
          EXECUTION_CPU_LIMIT,
          '--memory',
          EXECUTION_MEMORY_LIMIT,
          '--network=none',
          '--cap-drop=ALL',
          '-v',
          `${dockerPath}:/tmp/main.ts`,
          'code-executor:latest',
          '/bin/bash',
          '-lc',
          `ts-node --transpile-only --compiler-options '${TS_NODE_COMPILER_OPTIONS_JSON}' /tmp/main.ts`,
        ]
      } else {
        command = 'ts-node'
        args = ['--transpile-only', '--compiler-options', TS_NODE_COMPILER_OPTIONS_JSON, '-e', sourceCode]
      }
    } else if (runtime === 'cpp') {
      // C++ needs Docker
      if (!USE_DOCKER) {
        onError('C++ requires Docker to be enabled')
        return
      }
      // For C++, compile and run in Docker with volume mount
      tempFile = makeDsaRuntimeTempPath(`temp_${Date.now()}.cpp`)
      fs.writeFileSync(tempFile, sourceCode)
      
      // Convert Windows path to Docker-compatible format
      const dockerPath = tempFile.replace(/\\/g, '/')
      
      command = 'docker'
      args = [
        'run',
        '--rm',
        '-i',
        '--cpus',
        EXECUTION_CPU_LIMIT,
        '--memory',
        EXECUTION_MEMORY_LIMIT,
        '--network=none',
        '-v',
        `${dockerPath}:/tmp/main.cpp`,
        'code-executor:latest',
        '/bin/bash',
        '-c',
        `g++ -std=c++20 -O2 -pipe -o /tmp/main /tmp/main.cpp && stdbuf -o0 -i0 /tmp/main`,
      ]
    } else if (runtime === 'java') {
      // Java needs Docker
      if (!USE_DOCKER) {
        onError('Java requires Docker to be enabled')
        return
      }
      const className = sourceCode.match(/public\s+class\s+(\w+)/)?.[1] || 'Main'
      tempFile = makeDsaRuntimeTempPath(`temp_${Date.now()}.java`)
      fs.writeFileSync(tempFile, sourceCode)
      
      // Convert Windows path to Docker-compatible format
      const dockerPath = tempFile.replace(/\\/g, '/')
      
      command = 'docker'
      args = [
        'run',
        '--rm',
        '-i',
        '--cpus',
        EXECUTION_CPU_LIMIT,
        '--memory',
        EXECUTION_MEMORY_LIMIT,
        '--network=none',
        '-v',
        `${dockerPath}:/tmp/${className}.java`,
        'code-executor:latest',
        '/bin/bash',
        '-c',
        `javac -encoding UTF-8 -Xlint:none -nowarn /tmp/${className}.java && java -cp /tmp ${className}`,
      ]
    } else {
      onError(`Unsupported runtime: ${runtime}`)
      return
    }

    child = spawn(command, args, { 
      stdio: ['pipe', 'pipe', 'pipe']
    })

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      onOutput(text)
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      onOutput(text)
    })

    child.on('error', (error) => {
      onError(`Execution error: ${error.message}`)
      cleanupTempFile()
    })

    child.on('close', () => {
      onFinished()
      cleanupTempFile()
    })

    // Set up interactive input handler
    onWaitingInput((userInput) => {
      if (child && !child.killed) {
        child.stdin.write(userInput + '\n')
      }
    })

  } catch (error) {
    onError(`Failed to start execution: ${error.message}`)
    cleanupTempFile()
  }
}


const nowIso = () => new Date().toISOString()

const sanitizeDbText = (value = '') => String(value ?? '').split('\0').join('')

const normalizePath = (value = '') =>
  String(value)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')

const isUriLikePath = (value = '') => /^[a-z][a-z0-9+.-]*:/i.test(String(value || '').trim())

const isValidProjectRelativePath = (value = '') => {
  const normalized = normalizePath(value)
  if (!normalized) return false
  if (isUriLikePath(normalized)) return false
  if (normalized.includes('..')) return false
  return true
}

const normalizePathKey = (value = '') => normalizePath(value).toLowerCase()

const pathsEqualIgnoreCase = (firstPath, secondPath) => {
  const first = normalizePathKey(firstPath)
  const second = normalizePathKey(secondPath)
  return Boolean(first) && first === second
}

const getFileName = (path) => {
  const normalized = normalizePath(path)
  const segments = normalized.split('/')
  return segments[segments.length - 1] || normalized
}

const getParentFolderPath = (path) => {
  const normalized = normalizePath(path)
  if (!normalized || !normalized.includes('/')) return ''
  return normalized.slice(0, normalized.lastIndexOf('/'))
}

const isPathInside = (path, parentPath) => {
  const normalizedPath = normalizePath(path)
  const normalizedParent = normalizePath(parentPath)
  if (!normalizedParent) return true
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`)
}

const ensureFolderPath = (folderSet, folderPath) => {
  const normalized = normalizePath(folderPath)
  if (!normalized) return
  const parts = normalized.split('/')
  let accumulator = ''
  for (const part of parts) {
    accumulator = accumulator ? `${accumulator}/${part}` : part
    folderSet.add(accumulator)
  }
}

const sanitizeProjectPathState = (project) => {
  if (!project) return false

  let changed = false
  const nextFiles = new Map()
  const nextFolders = new Set()

  for (const folderPath of project.folders || []) {
    const normalizedFolderPath = normalizePath(folderPath)
    if (!isValidProjectRelativePath(normalizedFolderPath)) {
      changed = true
      continue
    }
    nextFolders.add(normalizedFolderPath)
  }

  for (const [fileId, file] of project.files || new Map()) {
    const normalizedFilePath = normalizePath(file?.path || file?.name)
    if (!isValidProjectRelativePath(normalizedFilePath)) {
      changed = true
      continue
    }

    const nextFileName = getFileName(normalizedFilePath)
    const shouldMutate = normalizedFilePath !== String(file?.path || '') || nextFileName !== String(file?.name || '')
    const nextFile = shouldMutate ? { ...file, path: normalizedFilePath, name: nextFileName } : file

    nextFiles.set(fileId, nextFile)
    ensureFolderPath(nextFolders, getParentFolderPath(normalizedFilePath))
    if (shouldMutate) changed = true
  }

  if (!changed) return false

  project.files = nextFiles
  project.folders = nextFolders
  project.updatedAt = nowIso()
  return true
}

const ensureReactViteDefaults = (project) => {
  if (project.templateId !== 'react-vite') return false

  const packageFile = Array.from(project.files.values()).find((file) => normalizePath(file.path || file.name) === 'package.json')
  if (!packageFile) return false

  let parsed
  try {
    parsed = JSON.parse(packageFile.content || '{}')
  } catch {
    return false
  }

  const next = {
    ...parsed,
    name: parsed.name || 'react-app',
    private: true,
    type: 'module',
    scripts: {
      ...(parsed.scripts || {}),
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
    },
    dependencies: {
      ...(parsed.dependencies || {}),
      react: (parsed.dependencies || {}).react || '^18.3.1',
      'react-dom': (parsed.dependencies || {})['react-dom'] || '^18.3.1',
    },
    devDependencies: {
      ...(parsed.devDependencies || {}),
      vite: (parsed.devDependencies || {}).vite || '^7.3.1',
      '@vitejs/plugin-react': (parsed.devDependencies || {})['@vitejs/plugin-react'] || '^5.0.0',
    },
  }

  const nextContent = `${JSON.stringify(next, null, 2)}\n`
  if (nextContent === packageFile.content) return false

  packageFile.content = nextContent
  const now = nowIso()
  packageFile.updatedAt = now
  project.updatedAt = now
  return true
}

const ensureFastApiRouteWiring = (project) => {
  if (project.templateId !== 'fastapi') return false

  const hasTasksRoute = Array.from(project.files.values()).some(
    (file) => normalizePath(file.path || file.name) === 'api/routes/tasks.py',
  )
  const hasStatsRoute = Array.from(project.files.values()).some(
    (file) => normalizePath(file.path || file.name) === 'api/routes/stats.py',
  )

  if (!hasTasksRoute && !hasStatsRoute) return false

  const appMainFile = Array.from(project.files.values()).find(
    (file) => normalizePath(file.path || file.name) === 'app/main.py',
  )
  if (!appMainFile) return false

  let content = String(appMainFile.content || '')
  if (!content.trim()) return false

  let changed = false
  const importLineRegex = /^from api\.routes import\s+(.+)$/m
  const importMatch = content.match(importLineRegex)

  if (importMatch) {
    const parts = importMatch[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)

    const nextParts = new Set(parts)
    nextParts.add('health')
    if (hasTasksRoute) nextParts.add('tasks')
    if (hasStatsRoute) nextParts.add('stats')

    const ordered = ['health', 'tasks', 'stats'].filter((key) => nextParts.has(key))
    const nextImportLine = `from api.routes import ${ordered.join(', ')}`

    if (importMatch[0] !== nextImportLine) {
      content = content.replace(importLineRegex, nextImportLine)
      changed = true
    }
  }

  if (hasTasksRoute && !/app\.include_router\(tasks\.router,\s*prefix=settings\.API_PREFIX\)/.test(content)) {
    const healthRouterLine = 'app.include_router(health.router, prefix=settings.API_PREFIX)'
    if (content.includes(healthRouterLine)) {
      content = content.replace(
        healthRouterLine,
        `${healthRouterLine}\napp.include_router(tasks.router, prefix=settings.API_PREFIX)`,
      )
    } else {
      content += '\napp.include_router(tasks.router, prefix=settings.API_PREFIX)\n'
    }
    changed = true
  }

  if (hasStatsRoute && !/app\.include_router\(stats\.router,\s*prefix=settings\.API_PREFIX\)/.test(content)) {
    const tasksRouterLine = 'app.include_router(tasks.router, prefix=settings.API_PREFIX)'
    const healthRouterLine = 'app.include_router(health.router, prefix=settings.API_PREFIX)'
    if (content.includes(tasksRouterLine)) {
      content = content.replace(
        tasksRouterLine,
        `${tasksRouterLine}\napp.include_router(stats.router, prefix=settings.API_PREFIX)`,
      )
    } else if (content.includes(healthRouterLine)) {
      content = content.replace(
        healthRouterLine,
        `${healthRouterLine}\napp.include_router(stats.router, prefix=settings.API_PREFIX)`,
      )
    } else {
      content += '\napp.include_router(stats.router, prefix=settings.API_PREFIX)\n'
    }
    changed = true
  }

  if (!changed) return false

  appMainFile.content = content
  appMainFile.updatedAt = nowIso()
  project.updatedAt = appMainFile.updatedAt
  return true
}

const terminalSessionKey = (ownerUserId, projectId, terminalId) => `${ownerUserId}:${projectId}:${terminalId}`
const userRoom = (userId) => `user:${userId}`

const getProjectTerminalWorkspace = (projectId, userId) => {
  const key = `${String(projectId || '')}:${String(userId || '')}`
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 16)
  return path.join(TERMINAL_WORKSPACES_ROOT, digest)
}

const isPathInsideWorkspace = (workspaceDir, candidatePath) => {
  const root = path.resolve(workspaceDir)
  const candidate = path.resolve(candidatePath)
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

const syncProjectFilesFromWorkspace = (project, workspaceDir) => {
  if (!fs.existsSync(workspaceDir)) return
  
  const newFiles = new Map(project.files || [])
  const newFolders = new Set(project.folders || [])
  
  const walkDir = (dir, relativePrefix) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        // Skip node_modules, .git, and hidden folders to avoid bloat
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        
        const absolutePath = path.join(dir, entry.name)
        const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
        
        if (entry.isDirectory()) {
          newFolders.add(relativePath)
          walkDir(absolutePath, relativePath)
        } else if (entry.isFile()) {
          const mimeType = inferMimeFromPath(relativePath)
          const isBinaryImage = Boolean(mimeType)

          // Try to find existing file in project
          let existingFile = Array.from(project.files.values()).find(f => f.path === relativePath)
          
          if (existingFile) {
            // Update existing file content
            if (isBinaryImage) {
              const binaryBuffer = fs.readFileSync(absolutePath)
              existingFile.content = `data:${mimeType};base64,${binaryBuffer.toString('base64')}`
              existingFile.isBinary = true
              existingFile.mimeType = mimeType
              existingFile.sizeBytes = binaryBuffer.length
            } else {
              existingFile.content = fs.readFileSync(absolutePath, 'utf8')
              existingFile.isBinary = false
              existingFile.mimeType = null
              existingFile.sizeBytes = Buffer.byteLength(existingFile.content ?? '', 'utf8')
            }
            existingFile.updatedAt = nowIso()
            newFiles.set(existingFile.id, existingFile)
          } else {
            // Create new file entry if it doesn't exist
            const fileId = randomUUID()
            if (isBinaryImage) {
              const binaryBuffer = fs.readFileSync(absolutePath)
              newFiles.set(fileId, {
                id: fileId,
                name: entry.name,
                path: relativePath,
                content: `data:${mimeType};base64,${binaryBuffer.toString('base64')}`,
                isBinary: true,
                mimeType,
                sizeBytes: binaryBuffer.length,
                updatedAt: nowIso(),
              })
            } else {
              const textContent = fs.readFileSync(absolutePath, 'utf8')
              newFiles.set(fileId, {
                id: fileId,
                name: entry.name,
                path: relativePath,
                content: textContent,
                isBinary: false,
                mimeType: null,
                sizeBytes: Buffer.byteLength(textContent ?? '', 'utf8'),
                updatedAt: nowIso(),
              })
            }
          }
          
          // Ensure parent folder path exists
          const parentPath = getParentFolderPath(relativePath)
          if (parentPath) newFolders.add(parentPath)
        }
      }
    } catch {
      // Ignore read errors
    }
  }
  
  walkDir(workspaceDir, '')
  
  // Merge workspace changes without dropping hidden/generated project files
  project.files = newFiles
  project.folders = newFolders
  sanitizeProjectPathState(project)
  project.updatedAt = nowIso()
}

const syncProjectFilesToWorkspace = (project, workspaceDir) => {
  sanitizeProjectPathState(project)
  fs.mkdirSync(workspaceDir, { recursive: true })

  const filePathKeySet = new Set(
    Array.from(project.files.values())
      .map((file) => normalizePathKey(file.path || file.name))
      .filter(Boolean),
  )

  for (const folderPath of project.folders || []) {
    const normalizedFolderPath = normalizePath(folderPath)
    if (!isValidProjectRelativePath(normalizedFolderPath)) continue
    if (filePathKeySet.has(normalizePathKey(normalizedFolderPath))) continue
    const absoluteFolderPath = path.join(workspaceDir, ...normalizedFolderPath.split('/'))
    try {
      fs.mkdirSync(absoluteFolderPath, { recursive: true })
    } catch (mkdirError) {
      void mkdirError
    }
  }

  const manifestPath = path.join(workspaceDir, '.collab-files.json')
  let previousPaths = []
  if (fs.existsSync(manifestPath)) {
    try {
      previousPaths = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch (manifestError) {
      void manifestError
      previousPaths = []
    }
  }

  const nextPathSet = new Set()
  const writtenFilePathKeys = new Set()
  for (const file of project.files.values()) {
    const relativePath = normalizePath(file.path || file.name)
    if (!isValidProjectRelativePath(relativePath)) continue

    const relativePathKey = normalizePathKey(relativePath)
    if (!relativePathKey || writtenFilePathKeys.has(relativePathKey)) continue

    const parentPath = getParentFolderPath(relativePath)
    const parentSegments = parentPath ? parentPath.split('/') : []
    let ancestorPath = ''
    let hasFileAncestorConflict = false
    for (const segment of parentSegments) {
      ancestorPath = ancestorPath ? `${ancestorPath}/${segment}` : segment
      if (writtenFilePathKeys.has(normalizePathKey(ancestorPath))) {
        hasFileAncestorConflict = true
        break
      }
    }
    if (hasFileAncestorConflict) continue

    nextPathSet.add(relativePath)
    const absolutePath = path.join(workspaceDir, ...relativePath.split('/'))
    try {
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true })

      if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
        fs.rmSync(absolutePath, { recursive: true, force: true })
      }

      if (file.isBinary) {
        const contentValue = String(file.content || '')
        const fallbackDataUrl = relativePath === 'app/favicon.ico' ? NEXT_TEMPLATE_FAVICON_DATA_URL : ''
        const dataUrl = contentValue.startsWith('data:image/') ? contentValue : fallbackDataUrl
        if (dataUrl) {
          const base64Payload = dataUrl.split(',')[1] || ''
          const buffer = Buffer.from(base64Payload, 'base64')
          fs.writeFileSync(absolutePath, buffer)
        } else {
          fs.writeFileSync(absolutePath, Buffer.alloc(0))
        }
      } else {
        fs.writeFileSync(absolutePath, file.content ?? '', 'utf8')
      }
      writtenFilePathKeys.add(relativePathKey)
    } catch (writeError) {
      void writeError
    }
  }

  for (const oldPath of previousPaths) {
    if (nextPathSet.has(oldPath)) continue
    const absolutePath = path.join(workspaceDir, ...String(oldPath).split('/'))
    try {
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath)
      }
    } catch (removeError) {
      void removeError
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(Array.from(nextPathSet), null, 2), 'utf8')
}

const getActiveWorkspaceDirsForProject = (projectId) => {
  const dirs = new Set()
  for (const session of terminalSessions.values()) {
    if (session.projectId !== projectId) continue
    if (!session.workspaceDir) continue
    dirs.add(session.workspaceDir)
  }
  return Array.from(dirs)
}

const syncProjectToActiveWorkspaces = (projectId, project) => {
  const dirs = getActiveWorkspaceDirsForProject(projectId)
  for (const workspaceDir of dirs) {
    try {
      syncProjectFilesToWorkspace(project, workspaceDir)
    } catch (syncError) {
      void syncError
    }
  }
}

const syncFileToActiveWorkspaces = (projectId, filePath, content) => {
  const normalizedPath = normalizePath(filePath)
  if (!isValidProjectRelativePath(normalizedPath)) return

  const dirs = getActiveWorkspaceDirsForProject(projectId)
  for (const workspaceDir of dirs) {
    try {
      const absolutePath = path.join(workspaceDir, ...normalizedPath.split('/'))
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
      if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
        fs.rmSync(absolutePath, { recursive: true, force: true })
      }
      fs.writeFileSync(absolutePath, content ?? '', 'utf8')
    } catch (syncError) {
      void syncError
    }
  }
}

const scheduleFileSyncToActiveWorkspaces = (projectId, filePath, content) => {
  const normalizedPath = normalizePath(filePath)
  if (!isValidProjectRelativePath(normalizedPath)) return

  const key = `${projectId}::${normalizedPath}`
  const existingTimer = pendingWorkspaceFileSyncTimers.get(key)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  const timer = setTimeout(() => {
    pendingWorkspaceFileSyncTimers.delete(key)
    try {
      syncFileToActiveWorkspaces(projectId, normalizedPath, content)
    } catch (syncError) {
      void syncError
    }
  }, WORKSPACE_FILE_SYNC_DEBOUNCE_MS)

  pendingWorkspaceFileSyncTimers.set(key, timer)
}

const removeFileFromActiveWorkspaces = (projectId, filePath) => {
  const normalizedPath = normalizePath(filePath)
  if (!normalizedPath) return

  const dirs = getActiveWorkspaceDirsForProject(projectId)
  for (const workspaceDir of dirs) {
    try {
      const absolutePath = path.join(workspaceDir, ...normalizedPath.split('/'))
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath)
      }
    } catch (removeError) {
      void removeError
    }
  }
}

const normalizeShellProfile = (profile) => {
  const value = String(profile || '').trim().toLowerCase()
  if (!value) return 'default'
  if (value === 'command prompt') return 'cmd'
  if (value === 'powershell core') return 'pwsh'
  if (value === 'git bash') return 'git-bash'
  return value
}

const getGitBashCommandPath = () => {
  const candidates = [
    path.join(process.env.ProgramW6432 || '', 'Git', 'bin', 'bash.exe'),
    path.join(process.env.ProgramFiles || '', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'bin', 'bash.exe'),
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch (statError) {
      void statError
    }
  }

  return null
}

const getShellForCommand = (commandText, shellProfile = 'default') => {
  const normalizedProfile = normalizeShellProfile(shellProfile)

  if (process.platform === 'win32') {
    if (normalizedProfile === 'cmd') {
      return {
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', commandText],
      }
    }

    if (normalizedProfile === 'pwsh') {
      return {
        command: 'pwsh.exe',
        args: ['-NoProfile', '-Command', commandText],
      }
    }

    if (normalizedProfile === 'git-bash') {
      const gitBash = getGitBashCommandPath()
      if (gitBash) {
        return {
          command: gitBash,
          args: ['-lc', commandText],
        }
      }
    }

    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', commandText],
    }
  }

  if (normalizedProfile === 'zsh') {
    return {
      command: '/bin/zsh',
      args: ['-lc', commandText],
    }
  }

  if (normalizedProfile === 'sh') {
    return {
      command: '/bin/sh',
      args: ['-lc', commandText],
    }
  }

  return {
    command: '/bin/bash',
    args: ['-lc', commandText],
  }
}

const stopTerminalProcess = (session) => {
  const child = session?.child
  if (!child || child.killed) return Promise.resolve(false)

  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: ['ignore', 'ignore', 'ignore'],
        shell: false,
      })

      killer.on('error', () => resolve(false))
      killer.on('close', (code) => {
        if (code === 0 && session.child === child) {
          session.child = null
        }
        resolve(code === 0)
      })
    })
  }

  try {
    child.kill('SIGTERM')
    return Promise.resolve(true)
  } catch {
    return Promise.resolve(false)
  }
}

const getTerminalCwdDisplay = (workspaceDir, cwd) => {
  const relativePath = path.relative(workspaceDir, cwd || workspaceDir)
  if (!relativePath || relativePath === '.') return '/'
  return `/${relativePath.split(path.sep).join('/')}`
}

const getCdCompletionSuggestions = (project, session, rawInput) => {
  const input = String(rawInput || '')
  if (!/^cd(\s|$)/i.test(input)) return []

  const argument = input.length <= 2 ? '' : input.slice(2).trimStart()
  let normalizedArgument = argument.replace(/\\/g, '/')
  if (normalizedArgument === '.') normalizedArgument = './'
  if (normalizedArgument === '..') normalizedArgument = '../'
  const slashIndex = normalizedArgument.lastIndexOf('/')
  const basePart = slashIndex >= 0 ? normalizedArgument.slice(0, slashIndex + 1) : ''
  const prefix = slashIndex >= 0 ? normalizedArgument.slice(slashIndex + 1) : normalizedArgument
  const baseAbsolute = path.resolve(session.cwd, basePart || '.')

  if (!isPathInsideWorkspace(session.workspaceDir, baseAbsolute)) return []
  if (!fs.existsSync(baseAbsolute) || !fs.statSync(baseAbsolute).isDirectory()) return []

  const relativeBaseRaw = path.relative(session.workspaceDir, baseAbsolute)
  const relativeBase = normalizePath(relativeBaseRaw === '.' ? '' : relativeBaseRaw.split(path.sep).join('/'))

  const entriesSet = new Set()
  for (const folderPath of project.folders || []) {
    const normalizedFolder = normalizePath(folderPath)
    if (!normalizedFolder) continue

    if (!relativeBase) {
      const first = normalizedFolder.split('/')[0]
      if (first) entriesSet.add(first)
      continue
    }

    if (!normalizedFolder.startsWith(`${relativeBase}/`)) continue
    const remaining = normalizedFolder.slice(relativeBase.length + 1)
    const first = remaining.split('/')[0]
    if (first) entriesSet.add(first)
  }

  const entries = Array.from(entriesSet).sort((a, b) => a.localeCompare(b))

  const lowerPrefix = prefix.toLowerCase()
  return entries
    .filter((name) => name.toLowerCase().startsWith(lowerPrefix))
    .map((name) => `cd ${basePart}${name}`)
}

const serializeProjectForDb = (project) => ({
  id: project.id,
  name: project.name,
  language: project.language,
  templateId: project.templateId,
  templateVariantId: resolveTemplateVariantId(project.templateId, project.templateVariantId, project.language),
  projectType: project.projectType || 'project',
  sharedTerminalEnabled: Boolean(project.sharedTerminalEnabled),
  ownerId: project.ownerId,
  members: Array.from(project.members),
  memberMeta: Object.fromEntries(project.memberMeta.entries()),
  memberRoles: Object.fromEntries(project.memberRoles.entries()),
  folders: Array.from(project.folders),
  files: Array.from(project.files.values()),
  chat: project.chat,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
})

const deserializeProjectFromDb = (raw) => {
  const fileMap = new Map(
    (raw.files || [])
      .map((file) => {
        const normalizedPath = normalizePath(file.path)
        if (!isValidProjectRelativePath(normalizedPath)) return null
        return [file.id, { ...file, path: normalizedPath, name: getFileName(normalizedPath) }]
      })
      .filter(Boolean),
  )
  const folderSet = new Set(
    (raw.folders || [])
      .map((folder) => normalizePath(folder))
      .filter((folderPath) => isValidProjectRelativePath(folderPath)),
  )
  for (const file of fileMap.values()) {
    ensureFolderPath(folderSet, getParentFolderPath(file.path))
  }

  return {
    id: raw.id,
    name: raw.name,
    language: raw.language,
    templateId: raw.templateId || 'react-vite',
    templateVariantId: resolveTemplateVariantId(raw.templateId || 'react-vite', raw.templateVariantId, raw.language),
    projectType: raw.projectType || 'project',
    sharedTerminalEnabled: Boolean(raw.sharedTerminalEnabled),
    ownerId: raw.ownerId,
    members: new Set(raw.members || []),
    memberMeta: new Map(Object.entries(raw.memberMeta || {})),
    memberRoles: new Map(Object.entries(raw.memberRoles || {})),
    folders: folderSet,
    files: fileMap,
    chat: raw.chat || [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }
}

const persistLocalState = async () => {
  if (dbClient) return

  const payload = {
    users: Array.from(users.values()),
    projects: Array.from(projects.values()).map((project) => serializeProjectForDb(project)),
    invites: Array.from(invitations.values()),
  }

  fs.writeFileSync(LOCAL_STATE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

const loadLocalState = () => {
  if (dbClient) return
  if (!fs.existsSync(LOCAL_STATE_PATH)) return

  try {
    const raw = fs.readFileSync(LOCAL_STATE_PATH, 'utf8')
    if (!raw.trim()) return
    const parsed = JSON.parse(raw)

    for (const user of parsed.users || []) {
      users.set(user.id, user)
      usersByEmail.set(user.email, user.id)
    }

    for (const rawProject of parsed.projects || []) {
      const project = deserializeProjectFromDb(rawProject)
      projects.set(project.id, project)
    }

    for (const invite of parsed.invites || []) {
      invitations.set(invite.code, invite)
    }
  } catch (error) {
    console.error('Failed to load local state:', error.message)
  }
}

const persistUser = async (user) => {
  if (!dbClient) {
    await persistLocalState()
    return
  }
  await dbClient.query(
    `INSERT INTO collab_users (
       id, clerk_id, email, name, avatar_url, bio, pronouns, company, location,
       github_username, github_access_token, github_token_scope, github_connected_at,
       updated_at, last_active_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       clerk_id = EXCLUDED.clerk_id,
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       avatar_url = EXCLUDED.avatar_url,
       bio = EXCLUDED.bio,
       pronouns = EXCLUDED.pronouns,
       company = EXCLUDED.company,
       location = EXCLUDED.location,
       github_username = EXCLUDED.github_username,
       github_access_token = EXCLUDED.github_access_token,
       github_token_scope = EXCLUDED.github_token_scope,
       github_connected_at = EXCLUDED.github_connected_at,
       updated_at = NOW(),
       last_active_at = NOW()`,
    [
      user.id,
      user.id,
      user.email,
      user.name,
      String(user.avatarUrl || ''),
      String(user.bio || ''),
      String(user.pronouns || ''),
      String(user.company || ''),
      String(user.location || ''),
      String(user.githubUsername || ''),
      String(user.githubAccessToken || ''),
      String(user.githubTokenScope || ''),
      user.githubConnectedAt || null,
    ],
  )
}

const mapAppRoleToDbRole = (role, isOwner = false) => {
  if (isOwner) return 'admin'
  if (role === 'viewer') return 'viewer'
  return 'editor'
}

const mapDbRoleToAppRole = (dbRole, isOwner = false) => {
  if (isOwner || dbRole === 'admin') return 'owner'
  if (dbRole === 'viewer') return 'viewer'
  return 'collaborator'
}

const extensionToLanguage = (filePath) => {
  const ext = (path.extname(String(filePath || '')).toLowerCase() || '').replace('.', '')
  if (!ext) return 'plaintext'
  if (ext === 'js') return 'javascript'
  if (ext === 'ts') return 'typescript'
  if (ext === 'py') return 'python'
  if (ext === 'md') return 'markdown'
  if (ext === 'yml' || ext === 'yaml') return 'yaml'
  if (ext === 'cpp' || ext === 'cc' || ext === 'cxx') return 'cpp'
  return ext
}

const inferMimeFromPath = (filePath = '') => {
  const ext = (path.extname(String(filePath || '')).toLowerCase() || '').replace('.', '')
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'bmp') return 'image/bmp'
  if (ext === 'ico') return 'image/x-icon'
  return ''
}

const inferLivePreviewMimeType = (filePath = '') => {
  const ext = (path.extname(String(filePath || '')).toLowerCase() || '').replace('.', '')
  if (ext === 'html' || ext === 'htm') return 'text/html; charset=utf-8'
  if (ext === 'css') return 'text/css; charset=utf-8'
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'application/javascript; charset=utf-8'
  if (ext === 'json') return 'application/json; charset=utf-8'
  if (ext === 'txt' || ext === 'md') return 'text/plain; charset=utf-8'

  const imageMimeType = inferMimeFromPath(filePath)
  if (imageMimeType) return imageMimeType
  return 'application/octet-stream'
}

const decodeDataUrl = (value = '') => {
  const input = String(value || '')
  const match = input.match(/^data:([^;,]+);base64,(.+)$/s)
  if (!match) return null
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  }
}

const sanitizeLivePreviewPath = (rawPath = '') => {
  const normalized = normalizePath(rawPath)
  if (!normalized) return 'index.html'
  const segments = normalized.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '..')) return ''
  return normalized
}

const getProjectFileByRelativePath = (project, relativePath) => {
  const normalizedPath = normalizePath(relativePath)
  return Array.from(project.files.values()).find((entry) => normalizePath(entry.path || entry.name) === normalizedPath) || null
}

const createLivePreviewSession = (projectId, userId) => {
  const sessionId = randomUUID().replace(/-/g, '')
  const now = Date.now()
  const expiresAt = now + LIVE_PREVIEW_SESSION_TTL_MS

  livePreviewSessions.set(sessionId, {
    projectId,
    userId,
    createdAt: now,
    expiresAt,
  })

  for (const [id, session] of livePreviewSessions.entries()) {
    if (!session || Number(session.expiresAt || 0) <= now) {
      livePreviewSessions.delete(id)
    }
  }

  return {
    sessionId,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

const resolveLivePreviewSession = (sessionId) => {
  const entry = livePreviewSessions.get(sessionId)
  if (!entry) return null

  if (Number(entry.expiresAt || 0) <= Date.now()) {
    livePreviewSessions.delete(sessionId)
    return null
  }

  const project = projects.get(entry.projectId)
  if (!project || !project.members.has(entry.userId)) {
    livePreviewSessions.delete(sessionId)
    return null
  }

  return {
    session: entry,
    project,
  }
}

const getLivePreviewVersion = (project) => {
  let latestTimestamp = Number.NaN

  for (const file of project?.files?.values?.() || []) {
    const parsed = Date.parse(String(file?.updatedAt || ''))
    if (!Number.isFinite(parsed)) continue
    if (!Number.isFinite(latestTimestamp) || parsed > latestTimestamp) {
      latestTimestamp = parsed
    }
  }

  if (Number.isFinite(latestTimestamp)) {
    return new Date(latestTimestamp).toISOString()
  }

  return String(project?.updatedAt || '')
}

const buildLiveHtml = (htmlSource, sessionId, version = '') => {
  const basePrefix = `/live/${sessionId}/`
  let html = String(htmlSource || '')
  const versionSuffix = version ? `?v=${encodeURIComponent(version)}` : ''

  if (!/<base\s+href=/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n    <base href="${basePrefix}">`)
  }

  html = html.replace(/(src|href)=(['"])([^"']+)\2/gi, (_full, attr, quote, target) => {
    const rawTarget = String(target || '').trim()
    if (!rawTarget) return `${attr}=${quote}${rawTarget}${quote}`
    if (/^(https?:|data:|mailto:|tel:|javascript:|#|\/\/)/i.test(rawTarget)) {
      return `${attr}=${quote}${rawTarget}${quote}`
    }

    let normalizedTarget = rawTarget
    if (normalizedTarget.startsWith('/')) {
      normalizedTarget = normalizedTarget.slice(1)
    }
    if (normalizedTarget.startsWith('./')) {
      normalizedTarget = normalizedTarget.slice(2)
    }

    return `${attr}=${quote}${basePrefix}${normalizedTarget}${versionSuffix}${quote}`
  })

  const liveReloadScript = `\n<script>\n(() => {\n  const pingUrl = '${basePrefix}__ping';\n  let lastVersion = '';\n\n  const poll = async () => {\n    try {\n      const response = await fetch(pingUrl, { cache: 'no-store' });\n      if (!response.ok) return;\n      const data = await response.json();\n      const nextVersion = String(data.version || '');\n      if (!lastVersion) {\n        lastVersion = nextVersion;\n        return;\n      }\n      if (nextVersion && nextVersion !== lastVersion) {\n        window.location.reload();\n      }\n    } catch {}\n  };\n\n  const ensureCounterBinding = () => {\n    const counterBtn = document.getElementById('counterBtn');\n    if (!counterBtn || counterBtn.dataset.counterBound === 'true') return;\n    if (!/^Clicked:\\s*-?\\d+$/i.test(String(counterBtn.textContent || '').trim())) return;\n\n    let current = Number((counterBtn.textContent || '').replace(/[^0-9-]/g, '')) || 0;\n    counterBtn.dataset.counterBound = 'true';\n    counterBtn.addEventListener('click', () => {\n      current += 1;\n      counterBtn.textContent = 'Clicked: ' + current;\n    });\n  };\n\n  ensureCounterBinding();\n  poll();\n  setInterval(poll, 1000);\n})();\n</script>\n`

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${liveReloadScript}</body>`)
  }
  return `${html}${liveReloadScript}`
}

const sanitizeImageUploadPath = (targetFolderPath = '', fileName = '') => {
  const normalizedFolder = normalizePath(targetFolderPath)
  const normalizedName = normalizePath(fileName).split('/').pop() || ''
  const safeName = normalizedName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return normalizePath(normalizedFolder ? `${normalizedFolder}/${safeName}` : safeName)
}

const persistProject = async (project) => {
  sanitizeProjectPathState(project)

  if (!dbClient) {
    await persistLocalState()
    return
  }

  // Use an isolated client for this transaction so concurrent requests cannot
  // interleave statements into the same transaction context.
  const transactionClient = new Client({ connectionString: DATABASE_URL })
  await transactionClient.connect()

  await transactionClient.query('BEGIN')
  try {
    const createdAt = project.createdAt || nowIso()
    const updatedAt = project.updatedAt || nowIso()

    await transactionClient.query(
      `INSERT INTO collab_projects (id, owner_id, name, language, template_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         owner_id = EXCLUDED.owner_id,
         name = EXCLUDED.name,
         language = EXCLUDED.language,
         template_type = EXCLUDED.template_type,
         updated_at = EXCLUDED.updated_at`,
      [project.id, project.ownerId, project.name, project.language, project.templateId || null, createdAt, updatedAt],
    )

    await transactionClient.query('DELETE FROM collab_project_members WHERE project_id = $1', [project.id])
    for (const memberId of project.members) {
      const role = project.memberRoles.get(memberId) || 'collaborator'
      const dbRole = mapAppRoleToDbRole(role, memberId === project.ownerId)
      await transactionClient.query(
        `INSERT INTO collab_project_members (id, project_id, user_id, role_id, joined_at, invited_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (project_id, user_id) DO UPDATE SET
           role_id = EXCLUDED.role_id`,
        [
          randomUUID(),
          project.id,
          memberId,
          dbRole,
          project.createdAt || nowIso(),
          memberId === project.ownerId ? null : project.ownerId,
        ],
      )
    }

    await transactionClient.query('DELETE FROM collab_folders WHERE project_id = $1', [project.id])

    const folderIdByPath = new Map()
    const sortedFolders = Array.from(
      new Set(
        Array.from(project.folders || [])
      .map(normalizePath)
      .filter((folderPath) => isValidProjectRelativePath(folderPath)),
      ),
    ).sort((a, b) => {
      const depthDiff = a.split('/').length - b.split('/').length
      if (depthDiff !== 0) return depthDiff
      return a.localeCompare(b)
    })

    // Phase 1: ensure every folder row exists with a stable DB id.
    for (const folderPath of sortedFolders) {
      const upsertResult = await transactionClient.query(
        `INSERT INTO collab_folders (id, project_id, parent_folder_id, folder_name, folder_path, created_by, created_at, updated_at)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)
         ON CONFLICT (project_id, folder_path) DO UPDATE SET
           folder_name = EXCLUDED.folder_name,
           parent_folder_id = NULL,
           updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [
          randomUUID(),
          project.id,
          getFileName(folderPath),
          folderPath,
          project.ownerId,
          createdAt,
          updatedAt,
        ],
      )

      const persistedFolderId = upsertResult.rows?.[0]?.id
      if (persistedFolderId) {
        folderIdByPath.set(folderPath, persistedFolderId)
      }
    }

    // Phase 2: set parent links now that all folder ids are known.
    for (const folderPath of sortedFolders) {
      const parentPath = getParentFolderPath(folderPath)
      const parentFolderId = parentPath ? folderIdByPath.get(parentPath) || null : null

      await transactionClient.query(
        `UPDATE collab_folders
         SET parent_folder_id = $3,
             updated_at = $4
         WHERE project_id = $1 AND folder_path = $2`,
        [project.id, folderPath, parentFolderId, updatedAt],
      )
    }

    await transactionClient.query('DELETE FROM collab_files WHERE project_id = $1', [project.id])

    for (const file of project.files.values()) {
      const normalizedPath = normalizePath(file.path || file.name)
      if (!isValidProjectRelativePath(normalizedPath)) continue

      const folderPath = getParentFolderPath(normalizedPath)
      const folderId = folderPath ? folderIdByPath.get(folderPath) || null : null
      const fileUpdatedAt = file.updatedAt || updatedAt
      const rawContent =
        typeof file.content === 'string' ? file.content : ((await getFileContent(project.id, file.id)) ?? '')
      const resolvedContent = sanitizeDbText(rawContent)
      const sizeBytes = Number.isFinite(Number(file.sizeBytes))
        ? Math.max(0, Number(file.sizeBytes))
        : Buffer.byteLength(String(resolvedContent || ''), 'utf8')

      const fileUpsertResult = await transactionClient.query(
        `INSERT INTO collab_files (id, project_id, folder_id, file_name, file_path, language, size_bytes, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (project_id, file_path) DO UPDATE SET
           file_name = EXCLUDED.file_name,
           folder_id = EXCLUDED.folder_id,
           language = EXCLUDED.language,
           size_bytes = EXCLUDED.size_bytes,
           updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [
          file.id,
          project.id,
          folderId,
          getFileName(normalizedPath),
          normalizedPath,
          extensionToLanguage(normalizedPath),
          sizeBytes,
          project.ownerId,
          createdAt,
          fileUpdatedAt,
        ],
      )

      const persistedFileId = fileUpsertResult.rows?.[0]?.id || file.id

      await transactionClient.query(
        `INSERT INTO collab_file_content (id, file_id, content, blob_url, cloudinary_public_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (file_id) DO UPDATE SET
           content = EXCLUDED.content,
           blob_url = EXCLUDED.blob_url,
           cloudinary_public_id = EXCLUDED.cloudinary_public_id,
           updated_at = EXCLUDED.updated_at`,
        [
          randomUUID(),
          persistedFileId,
          resolvedContent,
          file.blobUrl || null,
          file.cloudinaryPublicId || null,
          fileUpdatedAt,
        ],
      )
    }

    await transactionClient.query('DELETE FROM collab_chat_messages WHERE project_id = $1', [project.id])
    for (const message of project.chat || []) {
      await transactionClient.query(
        `INSERT INTO collab_chat_messages (id, project_id, user_id, file_id, message_text, is_edited, edited_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          message.id || randomUUID(),
          project.id,
          message.userId || project.ownerId,
          null,
          sanitizeDbText(message.message || ''),
          false,
          null,
          message.createdAt || nowIso(),
        ],
      )
    }

    await transactionClient.query('COMMIT')
  } catch (error) {
    await transactionClient.query('ROLLBACK')
    throw error
  } finally {
    await transactionClient.end().catch(() => {})
  }
}

const persistInvite = async (invite) => {
  if (!dbClient) {
    await persistLocalState()
    return
  }

  const createdAt = invite.createdAt || nowIso()
  const defaultExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const roleId = mapAppRoleToDbRole(invite.role || 'collaborator', false)

  await dbClient.query(
    `INSERT INTO collab_invites (
       id, project_id, invite_code, invited_by, role_id, invited_email,
       uses_allowed, uses_remaining, expires_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (invite_code) DO UPDATE SET
       role_id = EXCLUDED.role_id,
       invited_email = EXCLUDED.invited_email,
       uses_allowed = EXCLUDED.uses_allowed,
       uses_remaining = EXCLUDED.uses_remaining,
       expires_at = EXCLUDED.expires_at,
       updated_at = NOW()`,
    [
      invite.id || invite.code,
      invite.projectId,
      invite.code,
      invite.createdBy,
      roleId,
      invite.invitedEmail || null,
      -1,
      -1,
      invite.expiresAt || defaultExpiry,
      createdAt,
    ],
  )
}

const deleteProjectFromDb = async (projectId) => {
  if (!dbClient) {
    await persistLocalState()
    return
  }
  await dbClient.query('DELETE FROM collab_projects WHERE id = $1', [projectId])
  await dbClient.query('DELETE FROM collab_invites WHERE project_id = $1', [projectId])
}

const createExecutionJob = async (job) => {
  if (!dbClient) {
    executionJobs.set(job.id, { ...job, queuedAt: nowIso(), updatedAt: nowIso() })
    return
  }

  await dbClient.query(
    `INSERT INTO collab_execution_jobs (id, user_id, project_id, file_id, runtime, status, stdin_text, source_code, queued_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
    [job.id, job.userId, job.projectId, null, job.runtime, 'queued', job.stdin || '', job.sourceCode || ''],
  )
}

const recordProjectEvent = async ({
  projectId,
  userId,
  actionType,
  resourceType,
  resourceId = null,
  details = {},
  activityType = null,
  activityData = null,
}) => {
  if (!dbClient || !projectId || !userId || !actionType || !resourceType) return

  try {
    await dbClient.query(
      `INSERT INTO collab_audit_log (id, project_id, user_id, action_type, resource_type, resource_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
      [randomUUID(), projectId, userId, actionType, resourceType, resourceId, JSON.stringify(details || {})],
    )

    await dbClient.query(
      `INSERT INTO collab_activity_feed (id, project_id, user_id, activity_type, activity_data, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
      [
        randomUUID(),
        projectId,
        userId,
        activityType || actionType,
        JSON.stringify(activityData || details || {}),
      ],
    )
  } catch (error) {
    console.error('Failed to record activity event:', error.message)
  }
}

/**
 * File storage helpers - uses Cloudinary when configured, falls back to inline content
 */
const createFileRecord = async (projectId, filePath, content, userId) => {
  const lowerFilePath = String(filePath || '').toLowerCase()
  const cloudinaryBypassExtensions = ['.ps1', '.bat', '.cmd', '.sh']
  const shouldBypassCloudinaryUpload = cloudinaryBypassExtensions.some((ext) => lowerFilePath.endsWith(ext))

  if (!isCloudinaryConfigured()) {
    // Legacy mode: return file with inline content
    return {
      id: randomUUID(),
      name: getFileName(filePath),
      path: filePath,
      content: content,
      updatedAt: nowIso(),
    }
  }

  const normalizedContent = String(content ?? '')
  if (!normalizedContent.length) {
    return {
      id: randomUUID(),
      name: getFileName(filePath),
      path: filePath,
      content: normalizedContent,
      updatedAt: nowIso(),
    }
  }

  if (shouldBypassCloudinaryUpload) {
    return {
      id: randomUUID(),
      name: getFileName(filePath),
      path: filePath,
      content: normalizedContent,
      updatedAt: nowIso(),
    }
  }

  // Cloudinary mode: upload content and keep reference in memory,
  // persistProject() will sync metadata to PostgreSQL.
  try {
    const { url, publicId, version } = await fileStorage.uploadFile(projectId, filePath, normalizedContent, userId)
    const fileId = randomUUID()
    const now = nowIso()

    return {
      id: fileId,
      name: getFileName(filePath),
      path: filePath,
      content: normalizedContent,
      blobUrl: url,
      cloudinaryPublicId: publicId,
      version,
      updatedAt: now,
    }
  } catch (error) {
    if (process.env.FILE_UPLOAD_FALLBACK_LOGS === 'true') {
      const errorMessage = String(error?.message || error || '')
      console.warn(`File upload fallback for ${filePath}:`, errorMessage)
    }
    return {
      id: randomUUID(),
      name: getFileName(filePath),
      path: filePath,
      content: normalizedContent,
      updatedAt: nowIso(),
    }
  }
}

const createImageFileRecord = async (projectId, filePath, dataUrl, userId, sizeBytes = 0) => {
  const { url, publicId, version } = await fileStorage.uploadAsset(projectId, filePath, dataUrl, userId)
  const fileId = randomUUID()
  const now = nowIso()

  return {
    id: fileId,
    name: getFileName(filePath),
    path: filePath,
    content: dataUrl,
    blobUrl: url,
    cloudinaryPublicId: publicId,
    version,
    isBinary: true,
    mimeType: inferMimeFromPath(filePath) || 'application/octet-stream',
    sizeBytes: Number.isFinite(Number(sizeBytes)) ? Math.max(0, Number(sizeBytes)) : 0,
    updatedAt: now,
  }
}

const updateFileRecord = async (projectId, fileId, content) => {
  const normalizedContent = String(content ?? '')

  if (!isCloudinaryConfigured()) {
    // Legacy mode: return content directly
    return { content: normalizedContent, updatedAt: nowIso() }
  }

  const project = projects.get(projectId)
  const file = project?.files?.get(fileId)
  if (!file?.cloudinaryPublicId) {
    return { content: normalizedContent, updatedAt: nowIso() }
  }

  if (!normalizedContent.length) {
    return {
      content: normalizedContent,
      cloudinaryPublicId: file.cloudinaryPublicId,
      updatedAt: nowIso(),
    }
  }

  const { url, version } = await fileStorage.updateFile(file.cloudinaryPublicId, normalizedContent)
  const now = nowIso()

  return {
    content: normalizedContent,
    blobUrl: url,
    cloudinaryPublicId: file.cloudinaryPublicId,
    version,
    updatedAt: now,
  }
}

const renameFileRecord = async () => {
  // No-op: file metadata/path is persisted by persistProject() snapshot sync.
  return
}

const deleteFileRecord = async (projectId, fileId, fileRef = null) => {
  if (!isCloudinaryConfigured()) {
    return // Legacy mode: no-op
  }

  const project = projects.get(projectId)
  const file = fileRef || project?.files?.get(fileId)
  if (file?.cloudinaryPublicId) {
    await fileStorage.deleteFile(file.cloudinaryPublicId)
  }
}

const getFileContent = async (projectId, fileId) => {
  if (!isCloudinaryConfigured()) {
    // Legacy mode: content is already in memory
    const project = projects.get(projectId)
    if (!project) return null
    const file = project.files.get(fileId)
    return file ? file.content : null
  }

  const project = projects.get(projectId)
  if (!project) return null
  const file = project.files.get(fileId)
  if (!file) return null
  if (typeof file.content === 'string') return file.content

  if (file.blobUrl) {
    return await fileStorage.downloadFile(file.blobUrl)
  }

  if (!dbClient) return null
  const result = await dbClient.query(
    `SELECT blob_url, content FROM collab_file_content WHERE file_id = $1`,
    [fileId],
  )
  if (!result.rows.length) return null
  const row = result.rows[0]
  if (typeof row.content === 'string') return row.content
  if (row.blob_url) return await fileStorage.downloadFile(row.blob_url)
  return null
}

const getExecutionJobById = async (jobId) => {
  if (!dbClient) {
    return executionJobs.get(jobId) || null
  }

  const result = await dbClient.query(
    `SELECT id, user_id, project_id, file_id, runtime, status, result, error_text,
            queued_at, started_at, finished_at, updated_at
     FROM collab_execution_jobs
     WHERE id = $1`,
    [jobId],
  )

  if (!result.rows.length) return null
  const row = result.rows[0]
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    runtime: row.runtime,
    filePath: projects.get(row.project_id)?.files.get(row.file_id)?.path || null,
    fileId: row.file_id,
    status: row.status,
    result: row.result || null,
    errorText: row.error_text || null,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  }
}

const initDb = async () => {
  if (!DATABASE_URL) {
    loadLocalState()
    return
  }

  dbClient = new Client({ connectionString: DATABASE_URL })
  await dbClient.connect()

  await dbClient.query('ALTER TABLE collab_users ADD COLUMN IF NOT EXISTS avatar_url TEXT')
  await dbClient.query('ALTER TABLE collab_users ADD COLUMN IF NOT EXISTS bio TEXT')
  await dbClient.query('ALTER TABLE collab_users ADD COLUMN IF NOT EXISTS pronouns TEXT')
  await dbClient.query('ALTER TABLE collab_users ADD COLUMN IF NOT EXISTS company TEXT')
  await dbClient.query('ALTER TABLE collab_users ADD COLUMN IF NOT EXISTS location TEXT')
  await dbClient.query('ALTER TABLE collab_users ADD COLUMN IF NOT EXISTS github_username TEXT')
  await dbClient.query('ALTER TABLE collab_users ADD COLUMN IF NOT EXISTS github_access_token TEXT')
  await dbClient.query('ALTER TABLE collab_users ADD COLUMN IF NOT EXISTS github_token_scope TEXT')
  await dbClient.query('ALTER TABLE collab_users ADD COLUMN IF NOT EXISTS github_connected_at TIMESTAMPTZ')

  const usersResult = await dbClient.query(
    `SELECT id, email, name, avatar_url, bio, pronouns, company, location,
            github_username, github_access_token, github_token_scope, github_connected_at
       FROM collab_users`,
  )
  for (const row of usersResult.rows) {
    const user = {
      id: row.id,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatar_url || '',
      bio: row.bio || '',
      pronouns: row.pronouns || '',
      company: row.company || '',
      location: row.location || '',
      githubUsername: row.github_username || '',
      githubAccessToken: row.github_access_token || '',
      githubTokenScope: row.github_token_scope || '',
      githubConnectedAt: row.github_connected_at || null,
      passwordHash: '__clerk__',
    }
    users.set(user.id, user)
    usersByEmail.set(user.email, user.id)
  }

  const projectsResult = await dbClient.query(
    `SELECT id, owner_id, name, language, template_type, created_at, updated_at
     FROM collab_projects
     WHERE is_archived = false`,
  )
  for (const row of projectsResult.rows) {
    const resolvedTemplateId = row.template_type || 'react-vite'
    const project = {
      id: row.id,
      name: row.name,
      language: row.language || 'javascript',
      templateId: resolvedTemplateId,
      templateVariantId: resolveTemplateVariantId(resolvedTemplateId, null, row.language || 'javascript'),
      projectType: inferProjectTypeFromTemplate(resolvedTemplateId),
      sharedTerminalEnabled: false,
      ownerId: row.owner_id,
      members: new Set([row.owner_id]),
      memberMeta: new Map([[row.owner_id, { lastOpenedAt: null }]]),
      memberRoles: new Map([[row.owner_id, 'owner']]),
      folders: new Set(),
      files: new Map(),
      chat: [],
      createdAt: row.created_at || nowIso(),
      updatedAt: row.updated_at || nowIso(),
    }
    projects.set(project.id, project)
  }

  const membersResult = await dbClient.query(
    `SELECT pm.project_id, pm.user_id, pm.role_id
     FROM collab_project_members pm`,
  )
  for (const row of membersResult.rows) {
    const project = projects.get(row.project_id)
    if (!project) continue
    project.members.add(row.user_id)
    if (!project.memberMeta.has(row.user_id)) {
      project.memberMeta.set(row.user_id, { lastOpenedAt: null })
    }
    project.memberRoles.set(row.user_id, mapDbRoleToAppRole(row.role_id, row.user_id === project.ownerId))
  }

  const foldersResult = await dbClient.query('SELECT project_id, folder_path FROM collab_folders')
  for (const row of foldersResult.rows) {
    const project = projects.get(row.project_id)
    if (!project) continue
    const folderPath = normalizePath(row.folder_path)
    if (isValidProjectRelativePath(folderPath)) project.folders.add(folderPath)
  }

  const filesResult = await dbClient.query(
    `SELECT f.id, f.project_id, f.file_name, f.file_path, f.updated_at,
            fc.content, fc.blob_url, fc.cloudinary_public_id
     FROM collab_files f
     LEFT JOIN collab_file_content fc ON fc.file_id = f.id`,
  )
  for (const row of filesResult.rows) {
    const project = projects.get(row.project_id)
    if (!project) continue
    const normalizedPath = normalizePath(row.file_path || row.file_name)
    if (!isValidProjectRelativePath(normalizedPath)) continue
    const mimeType = inferMimeFromPath(normalizedPath)
    const isBinaryImage = Boolean(mimeType)
    const file = {
      id: row.id,
      name: getFileName(normalizedPath),
      path: normalizedPath,
      content: isBinaryImage ? '' : row.content || '',
      blobUrl: row.blob_url || null,
      cloudinaryPublicId: row.cloudinary_public_id || null,
      isBinary: isBinaryImage,
      mimeType: mimeType || null,
      updatedAt: row.updated_at || nowIso(),
    }
    project.files.set(file.id, file)
    ensureFolderPath(project.folders, getParentFolderPath(normalizedPath))
  }

  const chatResult = await dbClient.query(
    `SELECT id, project_id, user_id, message_text, created_at
     FROM collab_chat_messages
     ORDER BY created_at ASC`,
  )
  for (const row of chatResult.rows) {
    const project = projects.get(row.project_id)
    if (!project) continue
    const userName = users.get(row.user_id)?.name || `User-${String(row.user_id).slice(0, 6)}`
    project.chat.push({
      id: row.id,
      clientMessageId: null,
      message: row.message_text,
      userId: row.user_id,
      userName,
      createdAt: row.created_at || nowIso(),
    })
  }

  const invitesResult = await dbClient.query(
    `SELECT id, project_id, invite_code, role_id, invited_by, created_at
     FROM collab_invites
     WHERE expires_at > NOW()`,
  )
  for (const row of invitesResult.rows) {
    const invite = {
      id: row.id,
      code: String(row.invite_code || '').toUpperCase(),
      projectId: row.project_id,
      role: mapDbRoleToAppRole(row.role_id),
      createdBy: row.invited_by,
      createdAt: row.created_at || nowIso(),
    }
    invitations.set(invite.code, invite)
  }
}

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  avatarUrl: user.avatarUrl || '',
  bio: user.bio || '',
  pronouns: user.pronouns || '',
  company: user.company || '',
  location: user.location || '',
})

const isSyntheticUserName = (name) => {
  const normalized = String(name || '').trim()
  if (!normalized) return true
  return /^user[-_][a-z0-9]/i.test(normalized)
}

const parseUserFromClaims = (userId, claims = {}) => {
  const email =
    claims.email ||
    claims.email_address ||
    claims?.primary_email_address?.email_address ||
    claims?.email_addresses?.[0]?.email_address ||
    `${userId}@clerk.local`

  const name =
    claims.name ||
    [claims.first_name, claims.last_name].filter(Boolean).join(' ') ||
    [claims.given_name, claims.family_name].filter(Boolean).join(' ') ||
    claims.username ||
    String(email).split('@')[0] ||
    `User-${String(userId).slice(0, 6)}`

  return {
    id: userId,
    email: String(email).toLowerCase(),
    name: String(name).trim(),
    avatarUrl: '',
    bio: '',
    pronouns: '',
    company: '',
    location: '',
    githubUsername: '',
    githubAccessToken: '',
    githubTokenScope: '',
    githubConnectedAt: null,
    passwordHash: '__clerk__',
  }
}

const ensureUserFromClaims = async (userId, claims = {}) => {
  if (!userId) return null
  const existing = users.get(userId)
  if (existing) {
    const parsed = parseUserFromClaims(userId, claims)
    const nextName = parsed.name?.trim()
    const existingName = existing.name?.trim()
    const shouldUpgradeName =
      nextName && (!existingName || /^user[-_]/i.test(existingName) || existingName === String(existing.email).split('@')[0])

    if (shouldUpgradeName || (!existing.email && parsed.email)) {
      const updated = {
        ...existing,
        name: shouldUpgradeName ? nextName : existing.name,
        email: existing.email || parsed.email,
      }
      users.set(updated.id, updated)
      usersByEmail.set(updated.email, updated.id)
      await persistUser(updated)
      return updated
    }

    return existing
  }

  const user = parseUserFromClaims(userId, claims)
  users.set(user.id, user)
  usersByEmail.set(user.email, user.id)
  await persistUser(user)
  return user
}

const verifyClerkAuthToken = async (token) =>
  verifyToken(token, {
    secretKey: CLERK_SECRET_KEY,
    clockSkewInMs: CLERK_CLOCK_SKEW_MS,
  })

const authMiddleware = async (req, res, next) => {
  if (!CLERK_SECRET_KEY) {
    return res.status(500).json({ message: 'CLERK_SECRET_KEY is not configured' })
  }

  try {
    const auth = getAuth(req)

    if (auth?.userId) {
      req.userId = auth.userId
      await ensureUserFromClaims(auth.userId, auth.sessionClaims || {})
      return next()
    }

    const header = req.headers.authorization || req.headers.Authorization
    const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!bearer) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const payload = await verifyClerkAuthToken(bearer)
    req.userId = payload.sub
    await ensureUserFromClaims(payload.sub, payload)

    next()
  } catch (error) {
    return res.status(401).json({
      message: `Invalid token${error?.message ? `: ${error.message}` : ''}`,
    })
  }
}

const getMemberRole = (project, userId) => {
  if (project.ownerId === userId) return 'owner'
  return project.memberRoles.get(userId) || 'collaborator'
}

const canEditProject = (project, userId) => {
  const role = getMemberRole(project, userId)
  return role === 'owner' || role === 'collaborator'
}

const getUserDisplayName = (userId) => {
  const user = users.get(userId)
  const name = String(user?.name || '').trim()
  if (name) return name
  const emailName = String(user?.email || '').split('@')[0]
  if (emailName && !/@clerk\.local$/i.test(String(user?.email || ''))) return emailName
  return String(userId || 'Unknown')
}

const ensureGithubConfigured = () => {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_OAUTH_CALLBACK_URL) {
    return {
      error: {
        status: 503,
        message: 'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and GITHUB_OAUTH_CALLBACK_URL.',
      },
    }
  }
  return { ok: true }
}

const getGithubAccessTokenForUser = (userId) => {
  const user = users.get(userId)
  const token = String(user?.githubAccessToken || '').trim()
  if (!token) return ''
  return token
}

const githubApiRequest = async (token, endpoint, options = {}) => {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  })

  const rawBody = await response.text().catch(() => '')
  let payload = {}
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody)
    } catch {
      payload = { message: rawBody }
    }
  }

  if (!response.ok) {
    throw new Error(String(payload?.message || `GitHub request failed (${response.status})`))
  }

  return payload
}

const listProjectFilesForGithubUpload = async (project) => {
  const entries = []
  const sortedFiles = Array.from(project.files.values()).sort((a, b) =>
    String(a?.path || a?.name || '').localeCompare(String(b?.path || b?.name || '')),
  )

  for (const file of sortedFiles) {
    const relativePath = normalizePath(file?.path || file?.name || '')
    if (!relativePath) continue
    if (!isValidProjectRelativePath(relativePath)) continue

    if (file?.isBinary) {
      let binaryBuffer = null
      const inMemory = typeof file?.content === 'string' ? file.content : ''
      const decoded = decodeDataUrl(inMemory)
      if (decoded?.buffer) {
        binaryBuffer = decoded.buffer
      }

      if (!binaryBuffer && typeof file?.blobUrl === 'string' && file.blobUrl.trim()) {
        const blobUrl = file.blobUrl.trim()
        const decodedFromBlob = decodeDataUrl(blobUrl)
        if (decodedFromBlob?.buffer) {
          binaryBuffer = decodedFromBlob.buffer
        } else {
          const fetched = await fetch(blobUrl)
          if (fetched.ok) {
            binaryBuffer = Buffer.from(await fetched.arrayBuffer())
          }
        }
      }

      entries.push({
        path: relativePath,
        content: (binaryBuffer || Buffer.alloc(0)).toString('base64'),
        mode: '100644',
      })
      continue
    }

    const rawContent = typeof file?.content === 'string' ? file.content : ((await getFileContent(project.id, file.id)) ?? '')
    const textBuffer = Buffer.from(String(rawContent || ''), 'utf8')
    entries.push({
      path: relativePath,
      content: textBuffer.toString('base64'),
      mode: '100644',
    })
  }

  return entries
}

const cleanupExpiredGithubOauthStates = () => {
  const now = Date.now()
  for (const [state, entry] of githubOauthStates.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) {
      githubOauthStates.delete(state)
    }
  }
}

const serializeProjectSummary = (project, userId) => ({
  id: project.id,
  name: project.name,
  language: project.language,
  sharedTerminalEnabled: Boolean(project.sharedTerminalEnabled),
  ownerId: project.ownerId,
  ownerName: users.get(project.ownerId)?.name ?? 'Unknown',
  role: getMemberRole(project, userId),
  canEdit: canEditProject(project, userId),
  templateId: project.templateId,
  templateVariantId: resolveTemplateVariantId(project.templateId, project.templateVariantId, project.language),
  projectType: inferProjectTypeFromTemplate(project.templateId),
  updatedAt: project.updatedAt,
  lastOpenedAt: project.memberMeta.get(userId)?.lastOpenedAt ?? null,
})

const serializeProjectDetail = (project, userId) => ({
  id: project.id,
  name: project.name,
  language: project.language,
  sharedTerminalEnabled: Boolean(project.sharedTerminalEnabled),
  ownerId: project.ownerId,
  ownerName: users.get(project.ownerId)?.name ?? 'Unknown',
  role: getMemberRole(project, userId),
  canEdit: canEditProject(project, userId),
  templateId: project.templateId,
  templateVariantId: resolveTemplateVariantId(project.templateId, project.templateVariantId, project.language),
  projectType: inferProjectTypeFromTemplate(project.templateId),
  folders: Array.from(project.folders).sort((a, b) => a.localeCompare(b)),
  files: Array.from(project.files.values()),
  chat: project.chat,
  updatedAt: project.updatedAt,
})

const normalizeProjectName = (value = '') => String(value || '').trim().toLowerCase()

const sanitizeDownloadName = (value = '', fallback = 'project') => {
  const normalized = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
  return normalized || fallback
}

const projectNameExists = async (name, excludeProjectId = null) => {
  const normalizedName = normalizeProjectName(name)
  if (!normalizedName) return false

  const inMemoryExists = Array.from(projects.values()).some((project) => {
    if (!project?.id || project.id === excludeProjectId) return false
    return normalizeProjectName(project.name) === normalizedName
  })

  if (inMemoryExists) return true

  if (!dbClient) return false

  const result = await dbClient.query(
    `SELECT id FROM collab_projects
     WHERE LOWER(TRIM(name)) = $1
       AND ($2::text IS NULL OR id <> $2)
     LIMIT 1`,
    [normalizedName, excludeProjectId],
  )

  return result.rowCount > 0
}

const assertProjectMembership = (projectId, userId) => {
  const project = projects.get(projectId)
  if (!project) {
    return { error: { status: 404, message: 'Project not found' } }
  }

  const inferredType = inferProjectTypeFromTemplate(project.templateId)
  if (project.projectType !== inferredType) {
    project.projectType = inferredType
  }

  if (!project.members.has(userId)) {
    return { error: { status: 403, message: 'Forbidden' } }
  }
  return { project }
}

const clearProjectInvites = (projectId) => {
  for (const [code, invite] of invitations.entries()) {
    if (invite.projectId === projectId) {
      invitations.delete(code)
    }
  }
}

const stopProjectTerminals = async (projectId) => {
  const sessions = Array.from(terminalSessions.entries()).filter(([, session]) => session.projectId === projectId)
  for (const [key, session] of sessions) {
    await stopTerminalProcess(session).catch(() => false)
    terminalSessions.delete(key)
  }
}

app.get('/api/health', (_, res) => {
  res.json({
    ok: true,
    storage: {
      cloudinary: isCloudinaryConfigured(),
      postgres: Boolean(dbClient),
    },
    queue: {
      enabled: USE_EXECUTION_QUEUE,
      redis: isRedisConfigured(),
    },
  })
})

app.get('/api/templates', (req, res) => {
  const category = req.query.category // 'practice' or 'project'
  let templates = Object.values(PROJECT_TEMPLATES)
    .filter((template) => !template.hidden)
    .map((template) => ({
      id: template.id,
      label: template.label,
      description: getTemplateDescription(template.id),
      category: template.category,
      defaultLanguage: template.defaultLanguage,
      defaultVariantId: template.defaultVariantId || null,
      variants: Array.isArray(template.variants)
        ? template.variants.map((variant) => ({
            id: variant.id,
            label: variant.label,
            description: getTemplateVariantDescription(template.id, variant.id),
            defaultLanguage: variant.defaultLanguage || template.defaultLanguage,
          }))
        : [],
    }))

  if (category === 'practice') {
    templates = templates.filter((t) => t.category === 'practice')
  } else if (category === 'project') {
    templates = templates.filter((t) => t.category !== 'practice')
  }

  res.json({ templates })
})

app.get('/api/me', authMiddleware, (req, res) => {
  const user = users.get(req.userId)
  if (!user) {
    return res.status(404).json({ message: 'User not found' })
  }
  return res.json({ user: sanitizeUser(user) })
})

app.put('/api/me', authMiddleware, async (req, res) => {
  const user = users.get(req.userId)
  if (!user) {
    return res.status(404).json({ message: 'User not found' })
  }

  const name = String(req.body?.name || '').trim()
  const bio = String(req.body?.bio || '').trim()
  const pronouns = String(req.body?.pronouns || '').trim()
  const company = String(req.body?.company || '').trim()
  const location = String(req.body?.location || '').trim()
  const avatarUrl = String(req.body?.avatarUrl || '').trim()

  if (!name) {
    return res.status(400).json({ message: 'Name is required' })
  }

  if (name.length > 100 || bio.length > 300 || pronouns.length > 60 || company.length > 100 || location.length > 120) {
    return res.status(400).json({ message: 'One or more profile fields are too long' })
  }

  if (avatarUrl && !avatarUrl.startsWith('data:image/') && !/^https?:\/\//i.test(avatarUrl)) {
    return res.status(400).json({ message: 'Avatar must be an image data URL or an http/https URL' })
  }

  const updatedUser = {
    ...user,
    name,
    bio,
    pronouns,
    company,
    location,
    avatarUrl,
  }

  users.set(updatedUser.id, updatedUser)
  if (updatedUser.email) {
    usersByEmail.set(updatedUser.email, updatedUser.id)
  }
  await persistUser(updatedUser)

  return res.json({ user: sanitizeUser(updatedUser) })
})

app.get('/api/github/status', authMiddleware, async (req, res) => {
  const user = users.get(req.userId)
  if (!user) {
    return res.status(404).json({ message: 'User not found' })
  }

  const connected = Boolean(String(user.githubAccessToken || '').trim())
  return res.json({
    connected,
    username: String(user.githubUsername || '').trim(),
  })
})

app.get('/api/github/oauth/start', authMiddleware, async (req, res) => {
  const config = ensureGithubConfigured()
  if (config.error) {
    return res.status(config.error.status).json({ message: config.error.message })
  }

  cleanupExpiredGithubOauthStates()
  const state = randomUUID().replace(/-/g, '')
  const redirectPath = String(req.query.redirectPath || '/dashboard').trim()
  const safeRedirectPath = redirectPath.startsWith('/') ? redirectPath : '/dashboard'

  githubOauthStates.set(state, {
    userId: req.userId,
    redirectPath: safeRedirectPath,
    expiresAt: Date.now() + 10 * 60 * 1000,
  })

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_OAUTH_CALLBACK_URL,
    scope: 'repo',
    state,
    allow_signup: 'true',
  })

  return res.json({
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
  })
})

app.get('/api/github/oauth/callback', async (req, res) => {
  const oauthError = String(req.query.error || '').trim()
  const oauthErrorDescription = String(req.query.error_description || '').trim()
  const code = String(req.query.code || '').trim()
  const state = String(req.query.state || '').trim()

  cleanupExpiredGithubOauthStates()
  const stateEntry = githubOauthStates.get(state)
  if (stateEntry) {
    githubOauthStates.delete(state)
  }

  const redirectPath = stateEntry?.redirectPath || '/dashboard'
  const buildFrontendRedirect = (status, message = '') => {
    const params = new URLSearchParams({ github_oauth: status })
    if (message) {
      params.set('message', message)
    }
    return `${FRONTEND_BASE_URL}${redirectPath}?${params.toString()}`
  }

  if (!stateEntry || !stateEntry.userId) {
    return res.redirect(buildFrontendRedirect('error', 'OAuth state expired. Please try again.'))
  }

  if (oauthError) {
    return res.redirect(buildFrontendRedirect('error', oauthErrorDescription || oauthError))
  }

  if (!code) {
    return res.redirect(buildFrontendRedirect('error', 'GitHub did not return an authorization code.'))
  }

  const config = ensureGithubConfigured()
  if (config.error) {
    return res.redirect(buildFrontendRedirect('error', config.error.message))
  }

  try {
    const tokenExchangeResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_OAUTH_CALLBACK_URL,
        state,
      }).toString(),
    })

    const tokenPayload = await tokenExchangeResponse.json().catch(() => ({}))
    const githubAccessToken = String(tokenPayload?.access_token || '').trim()
    const tokenScope = String(tokenPayload?.scope || '').trim()
    if (!githubAccessToken) {
      const oauthMessage = String(tokenPayload?.error_description || tokenPayload?.error || 'Failed to obtain access token.')
      return res.redirect(buildFrontendRedirect('error', oauthMessage))
    }

    const githubProfile = await githubApiRequest(githubAccessToken, '/user')
    const githubUsername = String(githubProfile?.login || '').trim()
    if (!githubUsername) {
      return res.redirect(buildFrontendRedirect('error', 'Failed to resolve GitHub username.'))
    }

    const user = users.get(stateEntry.userId)
    if (!user) {
      return res.redirect(buildFrontendRedirect('error', 'User not found for OAuth state.'))
    }

    const nextUser = {
      ...user,
      githubUsername,
      githubAccessToken,
      githubTokenScope: tokenScope,
      githubConnectedAt: nowIso(),
    }

    users.set(nextUser.id, nextUser)
    usersByEmail.set(nextUser.email, nextUser.id)
    await persistUser(nextUser)

    return res.redirect(buildFrontendRedirect('success'))
  } catch (oauthCallbackError) {
    return res.redirect(buildFrontendRedirect('error', String(oauthCallbackError?.message || 'Failed to connect GitHub account.')))
  }
})

app.get('/api/github/repos', authMiddleware, async (req, res) => {
  const user = users.get(req.userId)
  if (!user) {
    return res.status(404).json({ message: 'User not found' })
  }

  const githubAccessToken = getGithubAccessTokenForUser(req.userId)
  if (!githubAccessToken) {
    return res.status(400).json({ message: 'GitHub account is not connected.' })
  }

  try {
    const repos = await githubApiRequest(
      githubAccessToken,
      '/user/repos?per_page=100&sort=updated&direction=desc&affiliation=owner',
    )

    const normalizedRepos = Array.isArray(repos)
      ? repos.map((repo) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          private: Boolean(repo.private),
          htmlUrl: repo.html_url,
          defaultBranch: repo.default_branch || 'main',
        }))
      : []

    return res.json({
      username: String(user.githubUsername || '').trim(),
      repos: normalizedRepos,
    })
  } catch (reposError) {
    return res.status(500).json({ message: reposError.message || 'Failed to fetch repositories' })
  }
})

app.get('/api/projects', authMiddleware, (req, res) => {
  const list = Array.from(projects.values())
    .filter((project) => project.members.has(req.userId))
    .map((project) => serializeProjectSummary(project, req.userId))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))

  return res.json({ projects: list })
})

app.post('/api/projects', authMiddleware, async (req, res) => {
  try {
    const { name, language, templateId, templateVariantId, projectType } = req.body

    if (!name?.trim()) {
      return res.status(400).json({ message: 'Project name is required' })
    }

    const trimmedName = String(name || '').trim()
    if (await projectNameExists(trimmedName)) {
      return res.status(409).json({ message: `"${trimmedName}" already exists, try a different name.` })
    }

    const type = projectType === 'practice' ? 'practice' : 'project'
    const projectId = randomUUID()
    const createdAt = nowIso()
    const selectedTemplate = getTemplate(templateId || language)
    const selectedVariant = getTemplateVariant(selectedTemplate, templateVariantId)
    const templateFiles = selectedTemplate.files({ name: trimmedName, variantId: selectedVariant?.id })
    const projectFiles = new Map()
    const projectFolders = new Set()

    for (const templateFile of templateFiles) {
      const filePath = normalizePath(templateFile.path)
      if (!filePath) continue

      const normalizedBinaryDataUrl =
        typeof templateFile.binaryDataUrl === 'string' && templateFile.binaryDataUrl.startsWith('data:image/')
          ? templateFile.binaryDataUrl
          : ''

      const file = normalizedBinaryDataUrl
        ? await createImageFileRecord(projectId, filePath, normalizedBinaryDataUrl, req.userId, templateFile.sizeBytes || 0)
        : await createFileRecord(projectId, filePath, templateFile.content || '', req.userId)
      projectFiles.set(file.id, file)
      ensureFolderPath(projectFolders, getParentFolderPath(filePath))
    }

    if (projectFiles.size === 0) {
      const fallbackContent = `# ${trimmedName}\n\nWelcome to your collaborative project.`
      const file = await createFileRecord(projectId, 'README.md', fallbackContent, req.userId)
      projectFiles.set(file.id, file)
    }

    const project = {
      id: projectId,
      name: trimmedName,
      language: selectedVariant?.defaultLanguage || selectedTemplate.defaultLanguage,
      templateId: selectedTemplate.id,
      templateVariantId: selectedVariant?.id || null,
      projectType: type,
      sharedTerminalEnabled: false,
      ownerId: req.userId,
      members: new Set([req.userId]),
      memberMeta: new Map([[req.userId, { lastOpenedAt: null }]]),
      memberRoles: new Map([[req.userId, 'owner']]),
      folders: projectFolders,
      files: projectFiles,
      chat: [],
      createdAt,
      updatedAt: createdAt,
    }

    projects.set(projectId, project)
    await persistProject(project)
    await recordProjectEvent({
      projectId,
      userId: req.userId,
      actionType: 'project_created',
      resourceType: 'project',
      resourceId: projectId,
      details: { name: project.name, templateId: project.templateId },
      activityType: 'project_created',
      activityData: {
        name: project.name,
        templateId: project.templateId,
        templateVariantId: project.templateVariantId,
        actorName: users.get(req.userId)?.name || '',
      },
    })

    return res.status(201).json({ project: serializeProjectDetail(project, req.userId) })
  } catch (error) {
    console.error('Failed to create project:', error)
    const message =
      typeof error?.message === 'string'
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Failed to create project'
    return res.status(500).json({ message })
  }
})

app.get('/api/projects/:projectId', authMiddleware, async (req, res) => {
  const { project, error } = assertProjectMembership(req.params.projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }

  ensureReactViteDefaults(project)

  project.memberMeta.set(req.userId, { lastOpenedAt: nowIso() })
  await persistProject(project)
  return res.json({ project: serializeProjectDetail(project, req.userId) })
})

app.get('/api/projects/:projectId/download', authMiddleware, async (req, res) => {
  const { projectId } = req.params
  const { project, error } = assertProjectMembership(projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }

  if (!canEditProject(project, req.userId)) {
    return res.status(403).json({ message: 'Only owner and collaborators can download project ZIP' })
  }

  try {
    const zip = new JSZip()
    const rootFolderName = sanitizeDownloadName(project?.name || 'project', 'project')
    const rootFolder = zip.folder(rootFolderName)

    const sortedFolders = Array.from(project.folders || []).sort((a, b) => String(a).localeCompare(String(b)))
    for (const folderPath of sortedFolders) {
      const normalizedFolderPath = normalizePath(folderPath)
      if (!normalizedFolderPath) continue
      if (!isValidProjectRelativePath(normalizedFolderPath)) continue
      rootFolder.folder(normalizedFolderPath)
    }

    const sortedFiles = Array.from(project.files.values()).sort((a, b) =>
      String(a?.path || a?.name || '').localeCompare(String(b?.path || b?.name || '')),
    )

    for (const file of sortedFiles) {
      const relativePath = normalizePath(file?.path || file?.name || '')
      if (!relativePath) continue
      if (!isValidProjectRelativePath(relativePath)) continue

      if (file?.isBinary) {
        let binaryBuffer = null

        if (typeof file?.content === 'string') {
          const decoded = decodeDataUrl(file.content)
          if (decoded?.buffer) {
            binaryBuffer = decoded.buffer
          }
        }

        if (!binaryBuffer && typeof file?.blobUrl === 'string' && file.blobUrl.trim()) {
          const blobUrl = file.blobUrl.trim()
          const decodedFromBlobUrl = decodeDataUrl(blobUrl)
          if (decodedFromBlobUrl?.buffer) {
            binaryBuffer = decodedFromBlobUrl.buffer
          } else {
            const fileResponse = await fetch(blobUrl)
            if (fileResponse.ok) {
              const arrayBuffer = await fileResponse.arrayBuffer()
              binaryBuffer = Buffer.from(arrayBuffer)
            }
          }
        }

        rootFolder.file(relativePath, binaryBuffer || Buffer.alloc(0))
        continue
      }

      const rawContent =
        typeof file?.content === 'string' ? file.content : ((await getFileContent(project.id, file.id)) ?? '')
      rootFolder.file(relativePath, String(rawContent || ''))
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    const downloadName = sanitizeDownloadName(project?.name || 'project', 'project')
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}.zip"`)
    res.setHeader('Content-Length', String(zipBuffer.length))
    return res.send(zipBuffer)
  } catch (downloadError) {
    console.error('Failed to build project zip:', downloadError)
    return res.status(500).json({ message: 'Failed to generate project ZIP' })
  }
})

app.post('/api/projects/:projectId/github/upload', authMiddleware, async (req, res) => {
  const { projectId } = req.params
  const { project, error } = assertProjectMembership(projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }

  const role = getMemberRole(project, req.userId)
  if (role !== 'owner') {
    return res.status(403).json({ message: 'Only project owner can upload to GitHub.' })
  }

  const user = users.get(req.userId)
  const githubAccessToken = getGithubAccessTokenForUser(req.userId)
  const githubUsername = String(user?.githubUsername || '').trim()
  if (!githubAccessToken || !githubUsername) {
    return res.status(400).json({ message: 'GitHub account is not connected.' })
  }

  try {
    const uploadMode = String(req.body?.mode || 'existing').trim().toLowerCase()
    let repositoryOwner = ''
    let repositoryName = ''

    if (uploadMode === 'new') {
      repositoryName = String(req.body?.repositoryName || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      if (!repositoryName) {
        return res.status(400).json({ message: 'Repository name is required for new repository upload.' })
      }

      const createdRepo = await githubApiRequest(githubAccessToken, '/user/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: repositoryName,
          private: Boolean(req.body?.isPrivate ?? true),
          auto_init: false,
        }),
      })

      repositoryOwner = String(createdRepo?.owner?.login || githubUsername).trim()
      repositoryName = String(createdRepo?.name || repositoryName).trim()
    } else {
      const repositoryFullName = String(req.body?.repositoryFullName || '').trim()
      const [ownerPart, repoPart] = repositoryFullName.split('/')
      repositoryOwner = String(ownerPart || '').trim()
      repositoryName = String(repoPart || '').trim()

      if (!repositoryOwner || !repositoryName) {
        return res.status(400).json({ message: 'Select a valid repository (owner/repo).' })
      }

      if (repositoryOwner.toLowerCase() !== githubUsername.toLowerCase()) {
        return res.status(403).json({ message: 'You can upload only to repositories in your own GitHub account.' })
      }
    }

    const repo = await githubApiRequest(
      githubAccessToken,
      `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}`,
    )

    const projectFiles = await listProjectFilesForGithubUpload(project)
    if (!projectFiles.length) {
      return res.status(400).json({ message: 'Project has no files to upload.' })
    }

    let parentCommitSha = ''
    let baseTreeSha = ''

    try {
      const mainRef = await githubApiRequest(
        githubAccessToken,
        `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/git/ref/heads/main`,
      )
      parentCommitSha = String(mainRef?.object?.sha || '').trim()
    } catch {
      parentCommitSha = ''
    }

    if (parentCommitSha) {
      const parentCommit = await githubApiRequest(
        githubAccessToken,
        `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/git/commits/${encodeURIComponent(parentCommitSha)}`,
      )
      baseTreeSha = String(parentCommit?.tree?.sha || '').trim()
    }

    const treeItems = []
    for (const file of projectFiles) {
      const blob = await githubApiRequest(
        githubAccessToken,
        `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/git/blobs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: file.content,
            encoding: 'base64',
          }),
        },
      )

      treeItems.push({
        path: file.path,
        mode: file.mode || '100644',
        type: 'blob',
        sha: blob.sha,
      })
    }

    const tree = await githubApiRequest(
      githubAccessToken,
      `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/git/trees`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_tree: baseTreeSha || undefined,
          tree: treeItems,
        }),
      },
    )

    const commit = await githubApiRequest(
      githubAccessToken,
      `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/git/commits`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: GITHUB_DEFAULT_COMMIT_MESSAGE,
          tree: tree.sha,
          parents: parentCommitSha ? [parentCommitSha] : [],
        }),
      },
    )

    if (parentCommitSha) {
      await githubApiRequest(
        githubAccessToken,
        `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/git/refs/heads/main`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sha: commit.sha, force: true }),
        },
      )
    } else {
      await githubApiRequest(
        githubAccessToken,
        `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/git/refs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: 'refs/heads/main', sha: commit.sha }),
        },
      )
    }

    return res.json({
      ok: true,
      message: 'Project uploaded to GitHub successfully.',
      branch: 'main',
      repository: {
        name: repo.name,
        fullName: repo.full_name,
        htmlUrl: repo.html_url,
        private: Boolean(repo.private),
      },
      commit: {
        sha: commit.sha,
        htmlUrl: String(repo.html_url || '').trim() ? `${String(repo.html_url || '').trim()}/commit/${commit.sha}` : '',
      },
    })
  } catch (uploadError) {
    console.error('GitHub upload failed:', uploadError)
    return res.status(500).json({ message: uploadError.message || 'Failed to upload project to GitHub.' })
  }
})

app.get('/api/projects/:projectId/voice/token', authMiddleware, async (req, res) => {
  const { projectId } = req.params
  const { project, error } = assertProjectMembership(projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }

  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return res.status(503).json({
      message: 'Voice channel is not configured on server. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.',
    })
  }

  try {
    const roomName = `project-${project.id}`
    const role = getMemberRole(project, req.userId)
    const participantUser = users.get(req.userId)
    const participantName = getUserDisplayName(req.userId)

    const accessToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: req.userId,
      name: participantName,
      metadata: JSON.stringify({
        userId: req.userId,
        name: participantName,
        role,
        avatarUrl: normalizeRealtimeAvatarUrl(participantUser?.avatarUrl),
        projectId: project.id,
      }),
      ttl: '12h',
    })

    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    })

    const token = await accessToken.toJwt()
    return res.json({
      token,
      url: LIVEKIT_URL,
      roomName,
    })
  } catch (voiceTokenError) {
    console.error('Failed to create voice token:', voiceTokenError)
    return res.status(500).json({ message: 'Failed to create voice channel token' })
  }
})

app.get('/api/projects/:projectId/voice/participants', authMiddleware, async (req, res) => {
  const { projectId } = req.params
  const { project, error } = assertProjectMembership(projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }

  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return res.status(503).json({
      message: 'Voice channel is not configured on server. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.',
    })
  }

  try {
    const roomName = `project-${project.id}`
    const roomService = new RoomServiceClient(toLiveKitApiUrl(LIVEKIT_URL), LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    const participants = await roomService.listParticipants(roomName)

    const normalizedParticipants = participants.map((participant) => {
      let metadata = {}
      try {
        metadata = participant?.metadata ? JSON.parse(participant.metadata) : {}
      } catch {
        metadata = {}
      }

      const identity = String(participant?.identity || metadata?.userId || '').trim()
      const name =
        String(participant?.name || metadata?.name || users.get(identity)?.name || 'User').trim() ||
        getUserDisplayName(identity)
      const avatarUrl = normalizeAvatarForUi(users.get(identity)?.avatarUrl || metadata?.avatarUrl)

      return {
        id: identity || `livekit-${Math.random().toString(36).slice(2, 9)}`,
        name,
        avatarUrl,
      }
    })

    return res.json({ participants: normalizedParticipants })
  } catch (voiceParticipantsError) {
    const errorMessage = String(voiceParticipantsError?.message || '').toLowerCase()
    if (errorMessage.includes('room does not exist') || errorMessage.includes('not found')) {
      return res.json({ participants: [] })
    }

    console.error('Failed to fetch voice participants:', voiceParticipantsError)
    return res.status(500).json({ message: 'Failed to fetch voice channel participants' })
  }
})

app.post('/api/projects/:projectId/live-session', authMiddleware, async (req, res) => {
  const { projectId } = req.params
  const { project, error } = assertProjectMembership(projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }

  if (project.templateId !== 'web-vanilla') {
    return res.status(400).json({ message: 'Live preview is available for the HTML/CSS/JS template only.' })
  }

  const { sessionId, expiresAt } = createLivePreviewSession(projectId, req.userId)
  const origin = `${req.protocol}://${req.get('host')}`

  return res.json({
    url: `${origin}/live/${sessionId}/`,
    expiresAt,
  })
})

app.get('/live/:sessionId/__ping', async (req, res) => {
  const resolved = resolveLivePreviewSession(String(req.params.sessionId || ''))
  if (!resolved) {
    return res.status(404).json({ message: 'Live session not found or expired' })
  }

  res.setHeader('Cache-Control', 'no-store')
  return res.json({
    ok: true,
    version: getLivePreviewVersion(resolved.project),
  })
})

const serveLivePreviewPath = async (req, res, sessionId, requestedPath = '') => {
  const resolved = resolveLivePreviewSession(String(sessionId || ''))
  if (!resolved) {
    return res.status(404).send('Live session not found or expired')
  }

  const relativePath = sanitizeLivePreviewPath(requestedPath)
  if (!relativePath) {
    return res.status(400).send('Invalid path')
  }

  const file = getProjectFileByRelativePath(resolved.project, relativePath)
  if (!file) {
    return res.status(404).send('File not found')
  }

  const rawContent =
    typeof file.content === 'string' ? file.content : ((await getFileContent(resolved.project.id, file.id)) ?? '')
  const normalizedFilePath = normalizePath(file.path || file.name || relativePath)
  const mimeType = inferLivePreviewMimeType(normalizedFilePath)
  const decodedBinary = decodeDataUrl(rawContent)

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')

  if (decodedBinary) {
    res.type(decodedBinary.mimeType || mimeType)
    return res.send(decodedBinary.buffer)
  }

  if (/\.html?$/i.test(normalizedFilePath)) {
    const html = buildLiveHtml(String(rawContent || ''), String(sessionId || ''), getLivePreviewVersion(resolved.project))
    res.type('text/html; charset=utf-8')
    return res.send(html)
  }

  res.type(mimeType)
  return res.send(String(rawContent || ''))
}

app.get('/live/:sessionId', async (req, res) => {
  return serveLivePreviewPath(req, res, req.params.sessionId, 'index.html')
})

app.get(/^\/live\/([^/]+)\/(.+)$/, async (req, res) => {
  const sessionId = String(req.params?.[0] || '')
  const requestedPath = String(req.params?.[1] || '').trim()
  return serveLivePreviewPath(req, res, sessionId, requestedPath)
})

app.get('/api/projects/:projectId/activity', authMiddleware, async (req, res) => {
  const { projectId } = req.params
  const { error } = assertProjectMembership(projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)

  if (!dbClient) {
    return res.json({ activities: [] })
  }

  try {
    const resolveActivityUserName = (row) => {
      const actorName = String(row.actor_name || row.latest_actor_name || '').trim()
      if (actorName && !isSyntheticUserName(actorName)) return actorName

      const inMemoryUser = users.get(row.user_id)
      const inMemoryName = String(inMemoryUser?.name || '').trim()
      const dbName = String(row.user_name || '').trim()
      const fallback = String(row.user_id || 'Unknown').trim()

      const candidate = inMemoryName || dbName || fallback
      const looksSynthetic = /^user[_-][a-z0-9]/i.test(candidate)

      if (looksSynthetic && inMemoryUser?.email && !/@clerk\.local$/i.test(inMemoryUser.email)) {
        return inMemoryUser.email.split('@')[0]
      }

      if (looksSynthetic && row.user_id === req.userId && inMemoryName) {
        return inMemoryName
      }

      return candidate || 'Unknown'
    }

    const result = await dbClient.query(
      `SELECT af.id, af.project_id, af.user_id, af.activity_type, af.activity_data, af.created_at,
              COALESCE(af.activity_data->>'actorName', '') AS actor_name,
              COALESCE(latest_actor.actor_name, '') AS latest_actor_name,
              COALESCE(u.name, split_part(u.email, '@', 1), af.user_id) AS user_name
       FROM collab_activity_feed af
       LEFT JOIN collab_users u ON u.id = af.user_id
       LEFT JOIN LATERAL (
         SELECT NULLIF(af2.activity_data->>'actorName', '') AS actor_name
         FROM collab_activity_feed af2
         WHERE af2.project_id = af.project_id
           AND af2.user_id = af.user_id
           AND NULLIF(af2.activity_data->>'actorName', '') IS NOT NULL
         ORDER BY af2.created_at DESC
         LIMIT 1
       ) latest_actor ON true
       WHERE af.project_id = $1
       ORDER BY af.created_at DESC
       LIMIT $2`,
      [projectId, limit],
    )

    return res.json({
      activities: result.rows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        userId: row.user_id,
        userName: resolveActivityUserName(row),
        activityType: row.activity_type,
        activityData: row.activity_data || {},
        createdAt: row.created_at,
      })),
    })
  } catch (activityError) {
    return res.status(500).json({ message: `Failed to fetch activity: ${activityError.message}` })
  }
})

app.delete('/api/projects/:projectId', authMiddleware, async (req, res) => {
  const { projectId } = req.params
  const { project, error } = assertProjectMembership(projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }

  if (project.ownerId !== req.userId) {
    return res.status(403).json({ message: 'Only owner can delete project' })
  }

  await stopProjectTerminals(projectId)
  clearProjectInvites(projectId)
  projects.delete(projectId)
  await deleteProjectFromDb(projectId)

  // Delete all Cloudinary files for this project
  if (isCloudinaryConfigured()) {
    await fileStorage.deleteProjectFolder(projectId)
  }

  return res.status(204).end()
})

/**
 * GET /api/projects/:projectId/files/:fileId/content
 * Fetch file content from Cloudinary (or in-memory fallback)
 */
app.get('/api/projects/:projectId/files/:fileId/content', authMiddleware, async (req, res) => {
  const { projectId, fileId } = req.params
  const { project, error } = assertProjectMembership(projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }

  const file = project.files.get(fileId)
  if (!file) {
    return res.status(404).json({ message: 'File not found' })
  }

  try {
    const content = await getFileContent(projectId, fileId)
    return res.json({ content: content || '' })
  } catch (err) {
    console.error('Error fetching file content:', err)
    return res.status(500).json({ message: 'Failed to fetch file content' })
  }
})

app.post('/api/projects/:projectId/files/upload-image', authMiddleware, async (req, res) => {
  const { projectId } = req.params
  const { targetFolderPath = '', fileName = '', dataUrl = '' } = req.body || {}
  const { project, error } = assertProjectMembership(projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }
  if (!canEditProject(project, req.userId)) {
    return res.status(403).json({ message: 'Read-only access' })
  }

  const normalizedPath = sanitizeImageUploadPath(targetFolderPath, fileName)
  if (!normalizedPath) {
    return res.status(400).json({ message: 'Valid image file name is required' })
  }

  const lowerPath = normalizedPath.toLowerCase()
  if (!/(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|\.bmp|\.ico)$/.test(lowerPath)) {
    return res.status(400).json({ message: 'Only image files are supported (.png, .jpg, .jpeg, .gif, .webp, .svg, .bmp, .ico)' })
  }

  const normalizedDataUrl = String(dataUrl || '').trim()
  if (!normalizedDataUrl.startsWith('data:image/')) {
    return res.status(400).json({ message: 'Invalid image payload. Expected image data URL.' })
  }

  const duplicateFile = Array.from(project.files.values()).some((file) => normalizePath(file.path) === normalizedPath)
  const duplicateFolder = project.folders.has(normalizedPath)
  if (duplicateFile || duplicateFolder) {
    return res.status(409).json({
      message: `A file or folder "${getFileName(normalizedPath)}" already exists at this location. Please choose a different name.`,
    })
  }

  const base64Payload = normalizedDataUrl.split(',')[1] || ''
  const sizeBytes = Buffer.byteLength(base64Payload, 'base64')
  if (sizeBytes > 8 * 1024 * 1024) {
    return res.status(413).json({ message: 'Image too large. Max 8MB allowed.' })
  }

  try {
    ensureFolderPath(project.folders, getParentFolderPath(normalizedPath))
    const file = await createImageFileRecord(projectId, normalizedPath, normalizedDataUrl, req.userId, sizeBytes)
    project.files.set(file.id, file)
    project.updatedAt = file.updatedAt
    await persistProject(project)
    await recordProjectEvent({
      projectId,
      userId: req.userId,
      actionType: 'file_created',
      resourceType: 'file',
      resourceId: file.id,
      details: { path: file.path, name: file.name, isBinary: true },
      activityType: 'file_created',
      activityData: {
        path: file.path,
        name: file.name,
        isBinary: true,
        actorName: users.get(req.userId)?.name || '',
      },
    })

    io.to(projectRoom(projectId)).emit('file:created', file)
    await broadcastProjectSnapshot(projectId, project)
    return res.status(201).json({ file })
  } catch (uploadError) {
    return res.status(500).json({ message: `Failed to upload image: ${uploadError.message}` })
  }
})

app.post('/api/projects/:projectId/invite', authMiddleware, async (req, res) => {
  const { projectId } = req.params
  const requestedRole = req.body?.role
  const actorNameFromClient = String(req.body?.actorName || req.body?.userName || '').trim()
  const { project, error } = assertProjectMembership(projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }

  if (getMemberRole(project, req.userId) !== 'owner') {
    return res.status(403).json({ message: 'Only owner can generate invite' })
  }

  const role = requestedRole === 'viewer' ? 'viewer' : 'collaborator'

  if (actorNameFromClient) {
    const currentUser = users.get(req.userId)
    if (currentUser) {
      const currentName = String(currentUser.name || '').trim()
      if (!currentName || isSyntheticUserName(currentName)) {
        const updatedUser = { ...currentUser, name: actorNameFromClient }
        users.set(updatedUser.id, updatedUser)
        if (updatedUser.email) {
          usersByEmail.set(updatedUser.email, updatedUser.id)
        }
        await persistUser(updatedUser)
      }
    }
  }

  const activityActorName =
    actorNameFromClient ||
    users.get(req.userId)?.name ||
    users.get(req.userId)?.email?.split('@')[0] ||
    ''

  const code = Math.random().toString(36).slice(2, 8).toUpperCase()
  const invite = {
    code,
    projectId,
    role,
    createdBy: req.userId,
    createdAt: nowIso(),
  }
  invitations.set(code, invite)
  await persistInvite(invite)
  await recordProjectEvent({
    projectId,
    userId: req.userId,
    actionType: 'invite_created',
    resourceType: 'invite',
    resourceId: code,
    details: { code, role },
    activityType: 'invite_created',
    activityData: { code, role, actorName: activityActorName },
  })

  return res.json({ code, role })
})

app.post('/api/projects/join', authMiddleware, async (req, res) => {
  const { code } = req.body
  const actorNameFromClient = String(req.body?.actorName || req.body?.userName || '').trim()
  if (!code) {
    return res.status(400).json({ message: 'Invite code is required' })
  }

  const invite = invitations.get(String(code).trim().toUpperCase())
  if (!invite) {
    return res.status(404).json({ message: 'Invite not found' })
  }

  const project = projects.get(invite.projectId)
  if (!project) {
    return res.status(404).json({ message: 'Project not found' })
  }

  if (actorNameFromClient) {
    const currentUser = users.get(req.userId)
    if (currentUser) {
      const currentName = String(currentUser.name || '').trim()
      if (!currentName || isSyntheticUserName(currentName)) {
        const updatedUser = { ...currentUser, name: actorNameFromClient }
        users.set(updatedUser.id, updatedUser)
        if (updatedUser.email) {
          usersByEmail.set(updatedUser.email, updatedUser.id)
        }
        await persistUser(updatedUser)
      }
    }
  }

  const activityActorName =
    actorNameFromClient ||
    users.get(req.userId)?.name ||
    users.get(req.userId)?.email?.split('@')[0] ||
    ''

  project.members.add(req.userId)
  if (!project.memberMeta.has(req.userId)) {
    project.memberMeta.set(req.userId, { lastOpenedAt: null })
  }
  if (!project.memberRoles.has(req.userId) || project.ownerId !== req.userId) {
    project.memberRoles.set(req.userId, invite.role || 'collaborator')
  }
  project.updatedAt = nowIso()
  await persistProject(project)
  await recordProjectEvent({
    projectId: project.id,
    userId: req.userId,
    actionType: 'member_joined',
    resourceType: 'member',
    resourceId: req.userId,
    details: { role: invite.role || 'collaborator', code: invite.code },
    activityType: 'member_joined',
    activityData: { role: invite.role || 'collaborator', actorName: activityActorName },
  })

  return res.json({ project: serializeProjectSummary(project, req.userId) })
})

app.get('/api/projects/:projectId/members', authMiddleware, async (req, res) => {
  const { projectId } = req.params
  const { project, error } = assertProjectMembership(projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }

  if (project.ownerId !== req.userId) {
    return res.status(403).json({ message: 'Only owner can view member management' })
  }

  try {
    const roomSockets = await io.in(projectRoom(projectId)).fetchSockets()
    const onlineUserIds = new Set(roomSockets.map((roomSocket) => roomSocket.userId).filter(Boolean))

    let members = []

    if (dbClient) {
      const membersResult = await dbClient.query(
        `SELECT pm.user_id, pm.role_id, pm.joined_at, u.name, u.email
         FROM collab_project_members pm
         LEFT JOIN collab_users u ON u.id = pm.user_id
         WHERE pm.project_id = $1
           AND pm.user_id <> $2`,
        [projectId, project.ownerId],
      )

      members = membersResult.rows.map((row) => {
        const memberId = row.user_id
        const dbName = String(row.name || '').trim()
        const dbEmail = String(row.email || '').trim()
        const role = mapDbRoleToAppRole(row.role_id, memberId === project.ownerId)
        const inMemorySeen = project.memberMeta.get(memberId)?.lastOpenedAt || null

        return {
          userId: memberId,
          userName: dbName || (dbEmail ? dbEmail.split('@')[0] : getUserDisplayName(memberId)),
          email: dbEmail,
          role,
          isOnline: onlineUserIds.has(memberId),
          lastSeenAt: inMemorySeen || row.joined_at || null,
        }
      })
    } else {
      members = Array.from(project.members)
        .filter((memberId) => memberId !== project.ownerId)
        .map((memberId) => {
          const memberUser = users.get(memberId)
          const role = project.memberRoles.get(memberId) || 'collaborator'
          const lastSeenAt = project.memberMeta.get(memberId)?.lastOpenedAt || null

          return {
            userId: memberId,
            userName: getUserDisplayName(memberId),
            email: memberUser?.email || '',
            role,
            isOnline: onlineUserIds.has(memberId),
            lastSeenAt,
          }
        })
    }

    members.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1
      return a.userName.localeCompare(b.userName)
    })

    return res.json({ members })
  } catch (membersError) {
    return res.status(500).json({ message: `Failed to load members: ${membersError.message}` })
  }
})

app.delete('/api/projects/:projectId/members/:memberId', authMiddleware, async (req, res) => {
  const { projectId, memberId } = req.params
  const { project, error } = assertProjectMembership(projectId, req.userId)
  if (error) {
    return res.status(error.status).json({ message: error.message })
  }

  if (project.ownerId !== req.userId) {
    return res.status(403).json({ message: 'Only owner can remove members' })
  }

  if (!memberId || memberId === project.ownerId) {
    return res.status(400).json({ message: 'Owner cannot be removed' })
  }

  if (!project.members.has(memberId)) {
    return res.status(404).json({ message: 'Member not found in project' })
  }

  const removedRole = project.memberRoles.get(memberId) || 'collaborator'
  const removedName = getUserDisplayName(memberId)

  project.members.delete(memberId)
  project.memberRoles.delete(memberId)
  project.memberMeta.delete(memberId)
  project.updatedAt = nowIso()

  await persistProject(project)
  await recordProjectEvent({
    projectId,
    userId: req.userId,
    actionType: 'member_removed',
    resourceType: 'member',
    resourceId: memberId,
    details: { removedUserId: memberId, removedUserName: removedName, role: removedRole },
    activityType: 'member_removed',
    activityData: {
      removedUserId: memberId,
      removedUserName: removedName,
      role: removedRole,
      actorName: users.get(req.userId)?.name || '',
    },
  })

  for (const [code, invite] of invitations.entries()) {
    if (invite.projectId === projectId && invite.createdBy === memberId) {
      invitations.delete(code)
    }
  }

  const removedUserSockets = await io.in(userRoom(memberId)).fetchSockets()
  for (const memberSocket of removedUserSockets) {
    memberSocket.leave(projectRoom(projectId))
    memberSocket.emit('project:access-removed', {
      projectId,
      projectName: project.name,
      message: `Your access to "${project.name}" was removed by the owner.`,
    })
  }

  await broadcastProjectSnapshot(projectId, project)
  return res.status(204).end()
})

app.post('/api/projects/:projectId/run', authMiddleware, async (req, res) => {
  try {
    const { projectId } = req.params
    const { filePath, stdin = '' } = req.body || {}
    const { project, error } = assertProjectMembership(projectId, req.userId)
    if (error) {
      return res.status(error.status).json({ message: error.message })
    }

    const normalizedFilePath = normalizePath(filePath)
    if (!normalizedFilePath) {
      return res.status(400).json({ message: 'filePath is required' })
    }

    const file = Array.from(project.files.values()).find((entry) => {
      const pathCandidate = normalizePath(entry.path || entry.name)
      return pathCandidate === normalizedFilePath
    })

    if (!file) {
      return res.status(404).json({ message: 'File not found in project' })
    }

    const runtime = runtimeForExtension(file.path || file.name)
    if (!runtime) {
      return res.status(400).json({
        message: 'Unsupported file type. Supported: .js, .py, .cpp, .java, .ts',
      })
    }

    if (project.projectType === 'practice' && !isPracticeRuntimeAllowed(project.language, runtime)) {
      return res.status(400).json({
        message: `This DSA project is locked to ${project.language}. Please run a ${project.language} file only.`,
      })
    }

    const stdinText = String(stdin ?? '')
    if (Buffer.byteLength(stdinText, 'utf8') > EXECUTION_STDIN_MAX_BYTES) {
      return res.status(413).json({
        message: `stdin is too large. Max allowed is ${EXECUTION_STDIN_MAX_BYTES} bytes.`,
      })
    }

    const sourceCode =
      typeof file.content === 'string' ? file.content : ((await getFileContent(projectId, file.id)) ?? '')

    if (USE_EXECUTION_QUEUE) {
      if (!isRedisConfigured()) {
        return res.status(500).json({ message: 'Execution queue is enabled but REDIS_URL is missing' })
      }
      if (!dbClient) {
        return res.status(500).json({ message: 'Execution queue requires DATABASE_URL (PostgreSQL)' })
      }

      const jobId = randomUUID()
      const payload = {
        id: jobId,
        userId: req.userId,
        projectId,
        runtime,
        filePath: file.path || file.name,
        stdin: stdinText,
        sourceCode,
      }

      await createExecutionJob(payload)
      await enqueueExecutionJob(payload)
      await recordProjectEvent({
        projectId,
        userId: req.userId,
        actionType: 'execution_queued',
        resourceType: 'execution_job',
        resourceId: jobId,
        details: { runtime, filePath: file.path || file.name },
        activityType: 'execution_queued',
        activityData: { runtime, filePath: file.path || file.name, actorName: users.get(req.userId)?.name || '' },
      })

      return res.status(202).json({
        queued: true,
        jobId,
        status: 'queued',
        runtime,
        filePath: file.path || file.name,
      })
    }

    const result = await runCode(runtime, sourceCode, stdinText)
    await recordProjectEvent({
      projectId,
      userId: req.userId,
      actionType: result?.ok ? 'execution_completed' : 'execution_failed',
      resourceType: 'execution',
      details: { runtime, filePath: file.path || file.name, ok: Boolean(result?.ok) },
      activityType: result?.ok ? 'execution_completed' : 'execution_failed',
      activityData: {
        runtime,
        filePath: file.path || file.name,
        ok: Boolean(result?.ok),
        actorName: users.get(req.userId)?.name || '',
      },
    })
    return res.json({
      queued: false,
      runtime,
      filePath: file.path || file.name,
      ...result,
    })
  } catch (error) {
    return res.status(500).json({
      message: `Run failed: ${error.message || 'Unknown server error'}`,
    })
  }
})

app.get('/api/executions/jobs/:jobId', authMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params
    const job = await getExecutionJobById(jobId)

    if (!job) {
      return res.status(404).json({ message: 'Execution job not found' })
    }

    if (job.userId !== req.userId) {
      return res.status(403).json({ message: 'Access denied' })
    }

    return res.json({ job })
  } catch (error) {
    return res.status(500).json({ message: `Unable to fetch job: ${error.message || 'Unknown error'}` })
  }
})

const projectRoom = (projectId) => `project:${projectId}`

const stopAllTerminalsForUserId = async (userId) => {
  const ownedSessions = Array.from(terminalSessions.values()).filter(
    (session) => session.ownerUserId === userId && session.child && !session.child.killed,
  )

  for (const session of ownedSessions) {
    await stopTerminalProcess(session)
  }
}

const emitTerminalEvent = (project, session, eventName, payload) => {
  const sharedOwnerTerminal = Boolean(project.sharedTerminalEnabled) && session.ownerUserId === project.ownerId

  if (sharedOwnerTerminal) {
    io.to(projectRoom(project.id)).emit(eventName, {
      ...payload,
      terminalOwnerId: session.ownerUserId,
      shared: true,
    })
    return
  }

  io.to(userRoom(session.ownerUserId)).emit(eventName, {
    ...payload,
    terminalOwnerId: session.ownerUserId,
    shared: false,
  })
}

const broadcastProjectSnapshot = async (projectId, project) => {
  const sockets = await io.in(projectRoom(projectId)).fetchSockets()
  for (const roomSocket of sockets) {
    roomSocket.emit('project:snapshot', serializeProjectDetail(project, roomSocket.userId))
  }
}

io.use(async (socket, next) => {
  if (!CLERK_SECRET_KEY) {
    return next(new Error('CLERK_SECRET_KEY is not configured'))
  }

  const token = socket.handshake.auth?.token
  if (!token) {
    return next(new Error('Unauthorized'))
  }

  try {
    const payload = await verifyClerkAuthToken(token)
    socket.userId = payload.sub
    const user = await ensureUserFromClaims(payload.sub, payload)
    socket.userName = user?.name?.trim() || user?.email?.split('@')[0] || `User-${String(payload.sub).slice(0, 6)}`
    return next()
  } catch {
    return next(new Error('Unauthorized'))
  }
})

io.on('connection', (socket) => {
  const pendingStopTimer = terminalDisconnectStopTimers.get(socket.userId)
  if (pendingStopTimer) {
    clearTimeout(pendingStopTimer)
    terminalDisconnectStopTimers.delete(socket.userId)
  }

  socket.join(userRoom(socket.userId))

  const handleProjectLeave = async (projectId) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project) return

    const roomName = projectRoom(projectId)
    socket.leave(roomName)

    try {
      const roomSockets = await io.in(roomName).fetchSockets()
      const stillOnlineInProject = roomSockets.some((roomSocket) => roomSocket.userId === socket.userId)
      if (!stillOnlineInProject) {
        project.memberMeta.set(socket.userId, { lastOpenedAt: nowIso() })
        project.updatedAt = nowIso()
      }
    } catch (presenceError) {
      void presenceError
    }

    socket.to(roomName).emit('presence:left', {
      userId: socket.userId,
      userName: socket.userName,
      projectId,
    })
  }

  socket.on('project:join', async ({ projectId }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project) {
      socket.emit('error:event', { message: 'Cannot join project' })
      return
    }

    const migratedReact = ensureReactViteDefaults(project)
    const migratedFastApi = ensureFastApiRouteWiring(project)
    if (migratedReact || migratedFastApi) {
      await persistProject(project)
    }

    project.memberMeta.set(socket.userId, { lastOpenedAt: nowIso() })
    project.updatedAt = nowIso()

    // Drop transient per-user ordering watermarks for this socket user on join.
    // This avoids reconnect sessions being blocked by stale in-memory version counters.
    for (const file of project.files.values()) {
      if (file && file._latestScheduledClientUpdateAtByUser && typeof file._latestScheduledClientUpdateAtByUser === 'object') {
        delete file._latestScheduledClientUpdateAtByUser[socket.userId]
      }
      if (file && file._latestAppliedClientUpdateAtByUser && typeof file._latestAppliedClientUpdateAtByUser === 'object') {
        delete file._latestAppliedClientUpdateAtByUser[socket.userId]
      }
    }

    socket.join(projectRoom(projectId))
    socket.to(projectRoom(projectId)).emit('presence:joined', {
      userId: socket.userId,
      userName: socket.userName,
      projectId,
    })

    socket.emit('project:snapshot', serializeProjectDetail(project, socket.userId))
  })

  socket.on('project:leave', async ({ projectId }) => {
    await handleProjectLeave(projectId)
  })

  socket.on('project:terminal-sharing:update', async ({ projectId, enabled }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project) return
    if (project.ownerId !== socket.userId) {
      socket.emit('error:event', { message: 'Only owner can change shared terminal mode' })
      return
    }

    project.sharedTerminalEnabled = Boolean(enabled)
    project.updatedAt = nowIso()
    await persistProject(project)
    await broadcastProjectSnapshot(projectId, project)
  })

  socket.on('file:create', async ({ projectId, path, content }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project || !canEditProject(project, socket.userId)) return

    const normalizedPath = normalizePath(path)
    if (!isValidProjectRelativePath(normalizedPath)) {
      socket.emit('error:event', { message: 'Invalid file path.' })
      return
    }

    if (!isPracticePathAllowed(project, normalizedPath)) {
      socket.emit('error:event', {
        message: `This DSA project is locked to ${project.language}. Please create a ${project.language} file only.`,
      })
      return
    }

    const duplicateFile = Array.from(project.files.values()).some((file) =>
      pathsEqualIgnoreCase(file.path, normalizedPath),
    )
    const duplicateFolder = Array.from(project.folders).some((folderPath) =>
      pathsEqualIgnoreCase(folderPath, normalizedPath),
    )
    if (duplicateFile || duplicateFolder) {
      socket.emit('error:event', {
        message: `A file or folder "${getFileName(normalizedPath)}" already exists at this location. Please choose a different name.`,
      })
      return
    }

    const parentFolderPath = getParentFolderPath(normalizedPath)
    ensureFolderPath(project.folders, parentFolderPath)

    // Use Cloudinary storage if configured
    const file = await createFileRecord(projectId, normalizedPath, content ?? '', socket.userId)
    project.files.set(file.id, file)
    ensureFastApiRouteWiring(project)
    project.updatedAt = file.updatedAt
    await persistProject(project)
    await recordProjectEvent({
      projectId,
      userId: socket.userId,
      actionType: 'file_created',
      resourceType: 'file',
      resourceId: file.id,
      details: { path: file.path, name: file.name },
      activityType: 'file_created',
      activityData: { path: file.path, name: file.name, actorName: socket.userName || '' },
    })
    scheduleFileSyncToActiveWorkspaces(projectId, file.path, file.content)

    io.to(projectRoom(projectId)).emit('file:created', file)
  })

  socket.on('file:rename', async ({ projectId, fileId, newPath }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project || !canEditProject(project, socket.userId)) return

    const normalizedPath = normalizePath(newPath)
    if (!isValidProjectRelativePath(normalizedPath)) {
      socket.emit('error:event', { message: 'Invalid file path.' })
      return
    }

    if (!isPracticePathAllowed(project, normalizedPath)) {
      socket.emit('error:event', {
        message: `This DSA project is locked to ${project.language}. Please rename to a ${project.language} file only.`,
      })
      return
    }

    const file = project.files.get(fileId)
    if (!file) return
    const previousPath = file.path

    const duplicateFile = Array.from(project.files.values()).some(
      (entry) => entry.id !== fileId && pathsEqualIgnoreCase(entry.path, normalizedPath),
    )
    const duplicateFolder = Array.from(project.folders).some((folderPath) =>
      pathsEqualIgnoreCase(folderPath, normalizedPath),
    )
    if (duplicateFile || duplicateFolder) {
      socket.emit('error:event', {
        message: `A file or folder "${getFileName(normalizedPath)}" already exists at this location. Please choose a different name.`,
      })
      return
    }

    file.name = getFileName(normalizedPath)
    file.path = normalizedPath
    file.updatedAt = nowIso()
    await renameFileRecord(projectId, fileId, normalizedPath)
    ensureFolderPath(project.folders, getParentFolderPath(normalizedPath))
    ensureFastApiRouteWiring(project)
    project.updatedAt = file.updatedAt
    await persistProject(project)
    await recordProjectEvent({
      projectId,
      userId: socket.userId,
      actionType: 'file_renamed',
      resourceType: 'file',
      resourceId: fileId,
      details: { oldPath: previousPath, newPath: file.path },
      activityType: 'file_renamed',
      activityData: { oldPath: previousPath, newPath: file.path, actorName: socket.userName || '' },
    })
    removeFileFromActiveWorkspaces(projectId, previousPath)
    syncFileToActiveWorkspaces(projectId, file.path, file.content)

    io.to(projectRoom(projectId)).emit('file:renamed', {
      fileId,
      name: file.name,
      path: file.path,
      updatedAt: file.updatedAt,
    })
  })

  socket.on('file:delete', async ({ projectId, fileId }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project || !canEditProject(project, socket.userId)) return

    const existing = project.files.get(fileId)
    if (!existing) return

    await deleteFileRecord(projectId, fileId, existing)
    project.files.delete(fileId)

    project.updatedAt = nowIso()
    await persistProject(project)
    await recordProjectEvent({
      projectId,
      userId: socket.userId,
      actionType: 'file_deleted',
      resourceType: 'file',
      resourceId: fileId,
      details: { path: existing.path, name: existing.name },
      activityType: 'file_deleted',
      activityData: { path: existing.path, name: existing.name, actorName: socket.userName || '' },
    })
    removeFileFromActiveWorkspaces(projectId, existing?.path)
    io.to(projectRoom(projectId)).emit('file:deleted', { fileId })
  })

  socket.on('file:update', async ({ projectId, fileId, content, clientUpdatedAt }, ack) => {
    const respond = (payload) => {
      if (typeof ack === 'function') {
        try {
          ack(payload)
        } catch {
          // Ignore ack transport issues.
        }
      }
    }

    try {
      const { project } = assertProjectMembership(projectId, socket.userId)
      if (!project || !canEditProject(project, socket.userId)) {
        console.warn('[collab] file:update rejected', {
          reason: 'forbidden_or_missing_project',
          projectId,
          fileId,
          userId: socket.userId,
        })
        respond({ ok: false, reason: 'forbidden_or_missing_project' })
        return
      }

      const file = project.files.get(fileId)
      if (!file) {
        console.warn('[collab] file:update rejected', {
          reason: 'file_not_found',
          projectId,
          fileId,
          userId: socket.userId,
        })
        respond({ ok: false, reason: 'file_not_found' })
        return
      }
      if (file.isBinary) {
        respond({ ok: false, reason: 'binary_file_not_editable' })
        return
      }

      const incomingVersion = Number(clientUpdatedAt)
      const normalizedVersion = Number.isFinite(incomingVersion) ? incomingVersion : Date.now()
      if (!file._latestScheduledClientUpdateAtByUser || typeof file._latestScheduledClientUpdateAtByUser !== 'object') {
        file._latestScheduledClientUpdateAtByUser = {}
      }
      const latestScheduledVersion = Number(file._latestScheduledClientUpdateAtByUser[socket.userId] || 0)
      if (normalizedVersion <= latestScheduledVersion) {
        console.warn('[collab] file:update rejected', {
          reason: 'stale_update',
          projectId,
          fileId,
          userId: socket.userId,
          incomingVersion: normalizedVersion,
          latestScheduledVersion,
        })
        respond({
          ok: false,
          reason: 'stale_update',
          incomingVersion: normalizedVersion,
          latestScheduledVersion,
        })
        return
      }
      file._latestScheduledClientUpdateAtByUser[socket.userId] = normalizedVersion

      const normalizedContent = String(content ?? '')
      const updatedAt = nowIso()

      file.content = normalizedContent
      file.updatedAt = updatedAt
      if (!file._latestAppliedClientUpdateAtByUser || typeof file._latestAppliedClientUpdateAtByUser !== 'object') {
        file._latestAppliedClientUpdateAtByUser = {}
      }
      file._latestAppliedClientUpdateAtByUser[socket.userId] = normalizedVersion
      project.updatedAt = updatedAt

      socket.to(projectRoom(projectId)).emit('file:updated', {
        fileId,
        content: file.content,
        updatedAt,
        clientUpdatedAt: normalizedVersion,
        userId: socket.userId,
        userName: socket.userName,
      })

      // Keep peer editing snappy: all heavier sync work is async/debounced.
      scheduleFileSyncToActiveWorkspaces(projectId, file.path, file.content)

      scheduleProjectPersist(projectId)
      respond({ ok: true, updatedAt, clientUpdatedAt: normalizedVersion })
    } catch (fileUpdateError) {
      console.error('[collab] file:update failed', {
        projectId,
        fileId,
        userId: socket.userId,
        error: fileUpdateError?.message || 'unknown_error',
      })
      respond({ ok: false, reason: 'server_error', message: fileUpdateError?.message || 'Unknown error' })
      socket.emit('error:event', { message: `File update failed: ${fileUpdateError?.message || 'Unknown error'}` })
    }
  })

  socket.on('folder:create', async ({ projectId, folderPath }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project || !canEditProject(project, socket.userId)) return

    const normalizedFolderPath = normalizePath(folderPath)
    if (!isValidProjectRelativePath(normalizedFolderPath)) {
      socket.emit('error:event', { message: 'Invalid folder path.' })
      return
    }

    const duplicateFolder = Array.from(project.folders).some((existingPath) =>
      pathsEqualIgnoreCase(existingPath, normalizedFolderPath),
    )
    const duplicateFile = Array.from(project.files.values()).some(
      (file) => pathsEqualIgnoreCase(file.path, normalizedFolderPath),
    )
    if (duplicateFolder || duplicateFile) {
      socket.emit('error:event', {
        message: `A file or folder "${getFileName(normalizedFolderPath)}" already exists at this location. Please choose a different name.`,
      })
      return
    }

    ensureFolderPath(project.folders, normalizedFolderPath)
    project.updatedAt = nowIso()
    await persistProject(project)
    await recordProjectEvent({
      projectId,
      userId: socket.userId,
      actionType: 'folder_created',
      resourceType: 'folder',
      resourceId: normalizedFolderPath,
      details: { path: normalizedFolderPath },
      activityType: 'folder_created',
      activityData: { path: normalizedFolderPath, actorName: socket.userName || '' },
    })
    syncProjectToActiveWorkspaces(projectId, project)
    await broadcastProjectSnapshot(projectId, project)
  })

  socket.on('folder:rename', async ({ projectId, oldPath, newPath }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project || !canEditProject(project, socket.userId)) return

    const normalizedOldPath = normalizePath(oldPath)
    const normalizedNewPath = normalizePath(newPath)
    if (!isValidProjectRelativePath(normalizedOldPath) || !isValidProjectRelativePath(normalizedNewPath)) {
      socket.emit('error:event', { message: 'Invalid folder path.' })
      return
    }

    const nextFolders = new Set()
    for (const folder of project.folders) {
      if (isPathInside(folder, normalizedOldPath)) {
        const suffix = folder.slice(normalizedOldPath.length)
        nextFolders.add(`${normalizedNewPath}${suffix}`.replace(/^\/+/, ''))
      } else {
        nextFolders.add(folder)
      }
    }
    ensureFolderPath(nextFolders, normalizedNewPath)
    project.folders = nextFolders

    for (const file of project.files.values()) {
      if (isPathInside(file.path, normalizedOldPath)) {
        const suffix = file.path.slice(normalizedOldPath.length)
        const updatedPath = `${normalizedNewPath}${suffix}`.replace(/^\/+/, '')
        file.path = updatedPath
        file.name = getFileName(updatedPath)
        file.updatedAt = nowIso()
        await renameFileRecord(projectId, file.id, updatedPath)
      }
    }

    project.updatedAt = nowIso()
    await persistProject(project)
    await recordProjectEvent({
      projectId,
      userId: socket.userId,
      actionType: 'folder_renamed',
      resourceType: 'folder',
      resourceId: normalizedOldPath,
      details: { oldPath: normalizedOldPath, newPath: normalizedNewPath },
      activityType: 'folder_renamed',
      activityData: { oldPath: normalizedOldPath, newPath: normalizedNewPath, actorName: socket.userName || '' },
    })
    syncProjectToActiveWorkspaces(projectId, project)
    await broadcastProjectSnapshot(projectId, project)
  })

  socket.on('folder:delete', async ({ projectId, folderPath }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project || !canEditProject(project, socket.userId)) return

    const normalizedFolderPath = normalizePath(folderPath)
    if (!normalizedFolderPath) return

    const nextFolders = new Set()
    for (const folder of project.folders) {
      if (!isPathInside(folder, normalizedFolderPath)) {
        nextFolders.add(folder)
      }
    }
    project.folders = nextFolders

    for (const [fileId, file] of project.files.entries()) {
      if (isPathInside(file.path, normalizedFolderPath)) {
        await deleteFileRecord(projectId, fileId)
        project.files.delete(fileId)
      }
    }

    project.updatedAt = nowIso()
    await persistProject(project)
    await recordProjectEvent({
      projectId,
      userId: socket.userId,
      actionType: 'folder_deleted',
      resourceType: 'folder',
      resourceId: normalizedFolderPath,
      details: { path: normalizedFolderPath },
      activityType: 'folder_deleted',
      activityData: { path: normalizedFolderPath, actorName: socket.userName || '' },
    })
    syncProjectToActiveWorkspaces(projectId, project)
    await broadcastProjectSnapshot(projectId, project)
  })

  socket.on('cursor:update', ({ projectId, fileId, position, isTyping }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project || !project.files.has(fileId)) return

    const user = users.get(socket.userId)

    socket.to(projectRoom(projectId)).emit('cursor:updated', {
      fileId,
      position,
      isTyping: Boolean(isTyping),
      userId: socket.userId,
      userName: socket.userName,
      avatarUrl: String(user?.avatarUrl || ''),
    })
  })

  socket.on('chat:send', async ({ projectId, message, clientMessageId, userName }, ack) => {
    const respond = (payload) => {
      if (typeof ack === 'function') {
        try {
          ack(payload)
        } catch {
          // Ignore ack transport issues.
        }
      }
    }

    try {
      const { project } = assertProjectMembership(projectId, socket.userId)
      if (!project) {
        respond({ ok: false, reason: 'project_not_found_or_forbidden' })
        return
      }

      if (!message?.trim()) {
        respond({ ok: false, reason: 'empty_message' })
        return
      }

      const resolvedUserName =
        String(userName || '').trim() ||
        users.get(socket.userId)?.name?.trim() ||
        socket.userName ||
        users.get(socket.userId)?.email?.split('@')[0] ||
        `User-${String(socket.userId).slice(0, 6)}`
      socket.userName = resolvedUserName

      const chatMessage = {
        id: randomUUID(),
        clientMessageId: clientMessageId || null,
        message: message.trim(),
        userId: socket.userId,
        userName: resolvedUserName,
        createdAt: new Date().toISOString(),
      }

      project.chat.push(chatMessage)
      project.updatedAt = chatMessage.createdAt
      await persistProject(project)
      await recordProjectEvent({
        projectId,
        userId: socket.userId,
        actionType: 'chat_message_sent',
        resourceType: 'chat_message',
        resourceId: chatMessage.id,
        details: { preview: chatMessage.message.slice(0, 120) },
        activityType: 'chat_message_sent',
        activityData: { preview: chatMessage.message.slice(0, 120), actorName: resolvedUserName },
      })
      io.to(projectRoom(projectId)).emit('chat:message', chatMessage)
      respond({ ok: true, id: chatMessage.id, createdAt: chatMessage.createdAt })
    } catch (chatError) {
      console.error('[collab] chat:send failed', {
        projectId,
        userId: socket.userId,
        error: chatError?.message || 'unknown_error',
      })
      respond({ ok: false, reason: 'server_error', message: chatError?.message || 'Unknown error' })
      socket.emit('error:event', { message: `Chat send failed: ${chatError?.message || 'Unknown error'}` })
    }
  })

  socket.on('terminal:run', ({ projectId, terminalId, command, shellProfile }) => {
    const { project, error } = assertProjectMembership(projectId, socket.userId)
    if (error) {
      socket.emit('terminal:error', { projectId, terminalId, message: error.message })
      return
    }

    if (project.sharedTerminalEnabled && !canEditProject(project, socket.userId)) {
      socket.emit('terminal:error', {
        projectId,
        terminalId,
        message: 'Shared terminal is view-only for viewers.',
      })
      return
    }

    const normalizedTerminalId = String(terminalId || 'terminal-1')
    const terminalOwnerUserId = project.sharedTerminalEnabled ? project.ownerId : socket.userId
    const workspaceDir = getProjectTerminalWorkspace(project.id, terminalOwnerUserId)

    const trimmedCommand = String(command || '').trim()
    if (!trimmedCommand) {
      socket.emit('terminal:error', { projectId, terminalId: normalizedTerminalId, message: 'Command cannot be empty' })
      return
    }

    try {
      syncProjectFilesToWorkspace(project, workspaceDir)
    } catch (syncError) {
      socket.emit('terminal:error', {
        projectId,
        terminalId: normalizedTerminalId,
        message: `Workspace sync failed: ${syncError.message}`,
      })
      return
    }

    const sessionKey = terminalSessionKey(terminalOwnerUserId, projectId, normalizedTerminalId)
    const existingSession = terminalSessions.get(sessionKey)

    const requestedShellProfile = normalizeShellProfile(shellProfile)

    const session =
      existingSession || {
        projectId,
        terminalId: normalizedTerminalId,
        ownerUserId: terminalOwnerUserId,
        workspaceDir,
        cwd: workspaceDir,
        shellProfile: requestedShellProfile,
        child: null,
      }

    if (!session.shellProfile) {
      session.shellProfile = requestedShellProfile || 'default'
    }

    if (!session.child || session.child.killed) {
      session.shellProfile = requestedShellProfile || session.shellProfile || 'default'
    }

    if (trimmedCommand === 'cd' || trimmedCommand.startsWith('cd ')) {
      const targetRaw = trimmedCommand === 'cd' ? '' : trimmedCommand.slice(3).trim()
      const nextPath = targetRaw
        ? (path.isAbsolute(targetRaw) ? path.resolve(targetRaw) : path.resolve(session.cwd, targetRaw))
        : workspaceDir

      if (!isPathInsideWorkspace(workspaceDir, nextPath)) {
        socket.emit('terminal:error', {
          projectId,
          terminalId: normalizedTerminalId,
          message: 'Access denied: cannot leave project workspace',
        })
        return
      }

      if (!fs.existsSync(nextPath) || !fs.statSync(nextPath).isDirectory()) {
        socket.emit('terminal:error', {
          projectId,
          terminalId: normalizedTerminalId,
          message: `The system cannot find the path specified: ${targetRaw || nextPath}`,
        })
        return
      }

      session.cwd = nextPath
      terminalSessions.set(sessionKey, session)
      emitTerminalEvent(project, session, 'terminal:cwd', {
        projectId,
        terminalId: normalizedTerminalId,
        cwd: session.cwd,
        cwdDisplay: getTerminalCwdDisplay(workspaceDir, session.cwd),
        projectName: project.name,
      })
      return
    }

    if (session.child && !session.child.killed) {
      socket.emit('terminal:error', {
        projectId,
        terminalId: normalizedTerminalId,
        message: 'A command is already running in this terminal. Stop it first (Ctrl+C), or open another terminal tab.',
      })
      return
    }

    const shell = getShellForCommand(trimmedCommand, session.shellProfile)
    const childEnv = {
      ...process.env,
      FORCE_COLOR: '0',
    }
    delete childEnv.PORT

    const child = spawn(shell.command, shell.args, {
      cwd: session.cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    })

    session.workspaceDir = workspaceDir
    session.child = child
    terminalSessions.set(sessionKey, session)

    emitTerminalEvent(project, session, 'terminal:started', {
      projectId,
      terminalId: normalizedTerminalId,
      command: trimmedCommand,
      shellProfile: session.shellProfile,
      cwd: session.cwd,
      cwdDisplay: getTerminalCwdDisplay(workspaceDir, session.cwd),
      projectName: project.name,
    })

    emitTerminalEvent(project, session, 'terminal:cwd', {
      projectId,
      terminalId: normalizedTerminalId,
      cwd: session.cwd,
      cwdDisplay: getTerminalCwdDisplay(workspaceDir, session.cwd),
      projectName: project.name,
    })

    child.stdout.on('data', (chunk) => {
      emitTerminalEvent(project, session, 'terminal:output', {
        projectId,
        terminalId: normalizedTerminalId,
        stream: 'stdout',
        text: chunk.toString(),
      })
    })

    child.stderr.on('data', (chunk) => {
      emitTerminalEvent(project, session, 'terminal:output', {
        projectId,
        terminalId: normalizedTerminalId,
        stream: 'stderr',
        text: chunk.toString(),
      })
    })

    child.on('error', (childError) => {
      const active = terminalSessions.get(sessionKey)
      if (active?.child === child) active.child = null
      emitTerminalEvent(project, session, 'terminal:error', {
        projectId,
        terminalId: normalizedTerminalId,
        message: `Terminal error: ${childError.message}`,
      })
    })

    child.on('close', (code, signal) => {
      const active = terminalSessions.get(sessionKey)
      if (active?.child === child) active.child = null
      try {
        syncProjectFilesFromWorkspace(project, session.workspaceDir)
        persistProject(project).catch(() => {})
      } catch (syncError) {
        void syncError
      }

      emitTerminalEvent(project, session, 'terminal:exit', {
        projectId,
        terminalId: normalizedTerminalId,
        code,
        signal,
      })

      broadcastProjectSnapshot(projectId, project).catch(() => {})
    })
  })

  socket.on('terminal:input', ({ projectId, terminalId, input }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project) return
    if (project.sharedTerminalEnabled && !canEditProject(project, socket.userId)) {
      socket.emit('terminal:error', {
        projectId,
        terminalId,
        message: 'Shared terminal is view-only for viewers.',
      })
      return
    }

    const normalizedTerminalId = String(terminalId || 'terminal-1')
    const terminalOwnerUserId = project.sharedTerminalEnabled ? project.ownerId : socket.userId
    const sessionKey = terminalSessionKey(terminalOwnerUserId, projectId, normalizedTerminalId)
    const session = terminalSessions.get(sessionKey)
    if (!session?.child || session.child.killed) return
    session.child.stdin.write(`${String(input ?? '')}\n`)
  })

  socket.on('terminal:complete', ({ projectId, terminalId, input }, ack) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project) {
      if (typeof ack === 'function') ack({ suggestions: [] })
      return
    }

    const normalizedTerminalId = String(terminalId || 'terminal-1')
    const terminalOwnerUserId = project.sharedTerminalEnabled ? project.ownerId : socket.userId
    const sessionKey = terminalSessionKey(terminalOwnerUserId, projectId, normalizedTerminalId)
    const workspaceDir = getProjectTerminalWorkspace(project.id, terminalOwnerUserId)

    try {
      syncProjectFilesToWorkspace(project, workspaceDir)
    } catch {
      if (typeof ack === 'function') ack({ suggestions: [] })
      return
    }

    const existingSession = terminalSessions.get(sessionKey)
    const session =
      existingSession || {
        projectId,
        terminalId: normalizedTerminalId,
        ownerUserId: terminalOwnerUserId,
        workspaceDir,
        cwd: workspaceDir,
        shellProfile: 'default',
        child: null,
      }

    if (!isPathInsideWorkspace(workspaceDir, session.cwd)) {
      session.cwd = workspaceDir
    } else {
      try {
        if (!fs.existsSync(session.cwd) || !fs.statSync(session.cwd).isDirectory()) {
          session.cwd = workspaceDir
        }
      } catch {
        session.cwd = workspaceDir
      }
    }

    terminalSessions.set(sessionKey, session)
    const suggestions = getCdCompletionSuggestions(project, session, input)
    if (typeof ack === 'function') ack({ suggestions })
  })

  socket.on('terminal:restore', ({ projectId }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project) return

    const ownerUserId =
      project.sharedTerminalEnabled && project.ownerId !== socket.userId ? project.ownerId : socket.userId

    const terminals = Array.from(terminalSessions.values())
      .filter((session) => session.projectId === projectId && session.ownerUserId === ownerUserId)
      .map((session) => ({
        terminalId: session.terminalId,
        cwd: session.cwd,
        cwdDisplay: getTerminalCwdDisplay(session.workspaceDir, session.cwd),
        shellProfile: normalizeShellProfile(session.shellProfile),
        isRunning: Boolean(session.child && !session.child.killed),
      }))

    socket.emit('terminal:restored', {
      projectId,
      projectName: project.name,
      ownerUserId,
      sharedReadOnly: project.sharedTerminalEnabled && project.ownerId !== socket.userId && !canEditProject(project, socket.userId),
      terminals,
    })
  })

  socket.on('terminal:stop', async ({ projectId, terminalId }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project) return
    if (project.sharedTerminalEnabled && !canEditProject(project, socket.userId)) {
      socket.emit('terminal:error', {
        projectId,
        terminalId,
        message: 'Shared terminal is view-only for viewers.',
      })
      return
    }

    const normalizedTerminalId = String(terminalId || 'terminal-1')
    const terminalOwnerUserId = project.sharedTerminalEnabled ? project.ownerId : socket.userId
    const sessionKey = terminalSessionKey(terminalOwnerUserId, projectId, normalizedTerminalId)
    const session = terminalSessions.get(sessionKey)
    if (!session) {
      const fallbackSessions = Array.from(terminalSessions.values()).filter((entry) => {
        if (entry.projectId !== projectId) return false
        if (entry.ownerUserId !== terminalOwnerUserId) return false
        return Boolean(entry.child && !entry.child.killed)
      })

      for (const fallbackSession of fallbackSessions) {
        await stopTerminalProcess(fallbackSession)
      }
      return
    }
    const stopped = await stopTerminalProcess(session)
    if (!stopped) {
      emitTerminalEvent(project, session, 'terminal:error', {
        projectId,
        terminalId: normalizedTerminalId,
        message: 'Failed to stop process in this terminal.',
      })
    }
  })

  socket.on('terminal:stop-all', async ({ projectId, terminalIds }) => {
    const { project } = assertProjectMembership(projectId, socket.userId)
    if (!project) return
    if (project.sharedTerminalEnabled && !canEditProject(project, socket.userId)) {
      socket.emit('terminal:error', {
        projectId,
        message: 'Shared terminal is view-only for viewers.',
      })
      return
    }

    const terminalOwnerUserId = project.sharedTerminalEnabled ? project.ownerId : socket.userId
    const requestedIds = Array.isArray(terminalIds)
      ? new Set(terminalIds.map((id) => String(id || '').trim()).filter(Boolean))
      : null

    const targetSessions = Array.from(terminalSessions.values()).filter((session) => {
      if (session.projectId !== projectId) return false
      if (session.ownerUserId !== terminalOwnerUserId) return false
      if (!session.child || session.child.killed) return false
      if (requestedIds && requestedIds.size > 0 && !requestedIds.has(session.terminalId)) return false
      return true
    })

    for (const session of targetSessions) {
      await stopTerminalProcess(session)
    }
  })

  // Interactive code execution with streaming I/O
  socket.on('code:run', async ({ projectId, filePath: requestedFilePath, sourceCode }) => {
    const { project, error } = assertProjectMembership(projectId, socket.userId)
    if (error) {
      socket.emit('code:error', { message: error.message })
      return
    }

    const normalizedFilePath = normalizePath(requestedFilePath)
    if (!normalizedFilePath) {
      socket.emit('code:error', { message: 'filePath is required' })
      return
    }

    const file = Array.from(project.files.values()).find((entry) => {
      const pathCandidate = normalizePath(entry.path || entry.name)
      return pathCandidate === normalizedFilePath
    })

    if (!file) {
      socket.emit('code:error', { message: 'File not found in project' })
      return
    }

    const runtime = runtimeForExtension(file.path || file.name)
    if (!runtime) {
      socket.emit('code:error', {
        message: 'Unsupported file type. Supported: .js, .py, .cpp, .java, .ts',
      })
      return
    }

    if (project.projectType === 'practice' && !isPracticeRuntimeAllowed(project.language, runtime)) {
      socket.emit('code:error', {
        message: `This DSA project is locked to ${project.language}. Please run a ${project.language} file only.`,
      })
      return
    }

    const content = sourceCode || file.content || ''

    if (
      runtime === 'javascript' &&
      /\b(prompt|alert|confirm|window\.|document\.)/i.test(content)
    ) {
      socket.emit('code:error', {
        message:
          'Browser APIs (prompt/alert/window/document) are not available in DSA runtime. Use stdin/stdout instead (fs.readFileSync(0, "utf8") + console.log).',
      })
      return
    }

    // Keep a live writer for stdin so every input line is forwarded
    let inputWriter = null

    const handleInput = (data) => {
      if (typeof inputWriter === 'function') {
        inputWriter(data.input)
      }
    }

    socket.on('code:input', handleInput)

    // Run code with interactive I/O
    try {
      await runCodeInteractive(
        runtime,
        content,
        (output) => {
          // Send output back to client
          socket.emit('code:output', { output })
        },
        (inputCallback) => {
          inputWriter = inputCallback
          socket.emit('code:waiting-input')
        },
        () => {
          // Program completed - clean up listener
          inputWriter = null
          socket.off('code:input', handleInput)
          socket.emit('code:finished')
        },
        (errorMsg) => {
          // Error occurred - clean up listener
          inputWriter = null
          socket.off('code:input', handleInput)
          socket.emit('code:error', { message: errorMsg })
        },
      )
    } catch (error) {
      inputWriter = null
      socket.off('code:input', handleInput)
      socket.emit('code:error', { message: `Execution error: ${error.message}` })
    }
  })

  socket.on('disconnect', async () => {
    const disconnectTimer = setTimeout(async () => {
      try {
        const activeSockets = await io.fetchSockets()
        const stillConnected = activeSockets.some((activeSocket) => activeSocket.userId === socket.userId)
        if (!stillConnected) {
          await stopAllTerminalsForUserId(socket.userId)
        }
      } finally {
        terminalDisconnectStopTimers.delete(socket.userId)
      }
    }, 3000)

    terminalDisconnectStopTimers.set(socket.userId, disconnectTimer)

    const rooms = Array.from(socket.rooms)
    for (const roomName of rooms) {
      if (roomName.startsWith('project:')) {
        const projectId = roomName.replace('project:', '')
        await handleProjectLeave(projectId)
      }
    }
  })
})

const start = async () => {
  try {
    if (USE_EXECUTION_QUEUE && !DATABASE_URL) {
      throw new Error('USE_EXECUTION_QUEUE=true requires DATABASE_URL')
    }

    if (USE_EXECUTION_QUEUE && !isRedisConfigured()) {
      throw new Error('USE_EXECUTION_QUEUE=true requires REDIS_URL')
    }

    await initDb()
    if (dbClient) {
      console.log('PostgreSQL persistence enabled')
    } else {
      console.log(`Local file persistence enabled at ${LOCAL_STATE_PATH} (set DATABASE_URL for PostgreSQL)`) 
    }

    if (USE_EXECUTION_QUEUE) {
      console.log('Execution queue mode enabled (BullMQ + Redis). Start worker: npm run dev:worker')
    } else {
      console.log('Execution queue mode disabled (inline execution mode)')
    }

    httpServer.on('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Stop the existing server process or change PORT in .env.`)
        process.exit(1)
      }
      console.error('HTTP server failed to start:', error)
      process.exit(1)
    })

    httpServer.listen(PORT, () => {
      console.log(`Collab server running on http://localhost:${PORT}`)
    })
  } catch (error) {
    console.error('Server startup failed:', error)
    process.exit(1)
  }
}

start()
