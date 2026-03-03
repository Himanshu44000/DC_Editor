import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EXECUTION_CPU_LIMIT = String(process.env.DSA_EXECUTION_CPUS || '1.5').trim()
const EXECUTION_MEMORY_LIMIT = String(process.env.DSA_EXECUTION_MEMORY || '1024m').trim()
const EXECUTION_TIMEOUT_MS = Math.max(2000, Number(process.env.DSA_EXECUTION_TIMEOUT_MS || 20000))
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
      resolve({ ok: false, exitCode: null, timedOut: false, stdout, stderr: `${stderr}${error.message}` })
    })

    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ ok: !timedOut && exitCode === 0, exitCode, timedOut, stdout, stderr })
    })

    if (input) {
      child.stdin.write(input)
    }
    child.stdin.end()
  })

const runDockerCode = async (runtime, sourceCode, stdinInput = '') => {
  ensureDsaRuntimeTempRoot()
  const tempDir = path.join(DSA_RUNTIME_TMP_ROOT, `.temp_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)

  try {
    fs.mkdirSync(tempDir, { recursive: true })

    let sourceFile = 'main.js'
    let runCommand = 'node /tmp/code/main.js'

    if (runtime === 'cpp') {
      sourceFile = 'main.cpp'
      runCommand = 'cd /tmp/code && g++ -std=c++20 -O2 main.cpp -o main && ./main'
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

    fs.writeFileSync(path.join(tempDir, sourceFile), sourceCode)
    if (runtime === 'typescript') {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), DSA_TYPESCRIPT_TSCONFIG)
    }

    return await runProcess({
      command: 'docker',
      args: [
        'run',
        '--rm',
        '-i',
        '-v',
        `${tempDir}:/tmp/code`,
        '--cpus',
        EXECUTION_CPU_LIMIT,
        '--memory',
        EXECUTION_MEMORY_LIMIT,
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
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: `Docker execution error: ${error.message}`,
    }
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    } catch (cleanupError) {
      void cleanupError
    }
  }
}

const runNativeCode = async (runtime, sourceCode) => {
  if (runtime === 'javascript') {
    return runProcess({ command: 'node', args: ['--input-type=module', '-'], input: sourceCode })
  }

  if (runtime === 'python') {
    return runProcess({ command: 'python', args: ['-'], input: sourceCode })
  }

  return {
    ok: false,
    exitCode: null,
    timedOut: false,
    stdout: '',
    stderr: `Native fallback is only available for JavaScript and Python. Runtime ${runtime} requires Docker.`,
  }
}

export const executeCode = async ({ runtime, sourceCode, stdin = '', useDocker = true }) => {
  if (!runtime) {
    return { ok: false, exitCode: null, timedOut: false, stdout: '', stderr: 'Runtime is required' }
  }

  if (useDocker) {
    return runDockerCode(runtime, sourceCode, stdin)
  }

  return runNativeCode(runtime, sourceCode)
}
