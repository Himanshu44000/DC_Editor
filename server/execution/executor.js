import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  resolveExecutionProvider,
  isJdoodleConfigured,
  shouldUseRemoteExecutionPrimary,
  executeWithJdoodle,
  isInfrastructureLikeExecutionFailure,
} from './providerRouting.js'

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
    const pythonResult = await runProcess({ command: 'python', args: ['-'], input: sourceCode })
    if (String(pythonResult?.stderr || '').includes('not recognized') || String(pythonResult?.stderr || '').includes('ENOENT')) {
      return runProcess({ command: 'py', args: ['-3', '-'], input: sourceCode })
    }
    return pythonResult
  }

  return {
    ok: false,
    exitCode: null,
    timedOut: false,
    stdout: '',
    stderr: `Native fallback is only available for JavaScript and Python. Runtime ${runtime} requires Docker.`,
  }
}

const runLocalCode = async ({ runtime, sourceCode, stdin = '', useDocker = true }) => {
  if (useDocker) {
    const dockerResult = await runDockerCode(runtime, sourceCode, stdin)
    if (dockerResult.ok || !isInfrastructureLikeExecutionFailure(dockerResult)) {
      return {
        ...dockerResult,
        provider: 'local',
        remoteAttempted: false,
        remoteCreditEstimated: 0,
        cacheable: dockerResult?.cacheable !== false,
      }
    }

    return {
      ...(await runNativeCode(runtime, sourceCode, stdin)),
      provider: 'local',
      remoteAttempted: false,
      remoteCreditEstimated: 0,
      cacheable: true,
      fallbackFrom: 'docker',
    }
  }

  const nativeResult = await runNativeCode(runtime, sourceCode, stdin)
  return {
    ...nativeResult,
    provider: 'local',
    remoteAttempted: false,
    remoteCreditEstimated: 0,
    cacheable: nativeResult?.cacheable !== false,
  }
}

export const executeCode = async ({ runtime, sourceCode, stdin = '', useDocker = true }) => {
  const normalizedRuntime = String(runtime || '').trim().toLowerCase()
  if (!normalizedRuntime) {
    return { ok: false, exitCode: null, timedOut: false, stdout: '', stderr: 'Runtime is required' }
  }

  const provider = resolveExecutionProvider()
  const runLocal = async () => runLocalCode({ runtime: normalizedRuntime, sourceCode, stdin, useDocker })

  const jsHybrid = provider === 'hybrid' && normalizedRuntime === 'javascript'
  if (jsHybrid) {
    const localResult = await runLocal()
    if (localResult.ok || !isInfrastructureLikeExecutionFailure(localResult) || !isJdoodleConfigured()) {
      return localResult
    }

    const remoteFallbackResult = await executeWithJdoodle({
      runtime: normalizedRuntime,
      sourceCode,
      stdin,
      timeoutMs: EXECUTION_TIMEOUT_MS,
    })

    if (remoteFallbackResult.ok) {
      return {
        ...remoteFallbackResult,
        provider: 'jdoodle',
        fallbackFrom: 'local',
      }
    }

    return {
      ...localResult,
      remoteAttempted: Boolean(remoteFallbackResult?.remoteAttempted),
      remoteCreditEstimated: Number(remoteFallbackResult?.remoteCreditEstimated || 0),
      cacheable: localResult?.cacheable !== false,
      stderr: [
        String(localResult.stderr || '').trim(),
        String(remoteFallbackResult?.stderr || '').trim(),
      ]
        .filter(Boolean)
        .join('\n\n--- JDoodle fallback ---\n'),
    }
  }

  const remotePrimary = shouldUseRemoteExecutionPrimary(normalizedRuntime, provider)
  if (remotePrimary) {
    if (!isJdoodleConfigured()) {
      if (provider === 'jdoodle') {
        return {
          ok: false,
          exitCode: 1,
          timedOut: false,
          stdout: '',
          stderr: 'JDoodle provider selected but credentials are missing. Set JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET.',
          provider: 'jdoodle',
          remoteAttempted: false,
          remoteCreditEstimated: 0,
          cacheable: false,
          errorCategory: 'provider_unavailable',
        }
      }

      return runLocal()
    }

    const remoteResult = await executeWithJdoodle({
      runtime: normalizedRuntime,
      sourceCode,
      stdin,
      timeoutMs: EXECUTION_TIMEOUT_MS,
    })

    if (remoteResult.ok || provider === 'jdoodle') {
      return remoteResult
    }

    if (!isInfrastructureLikeExecutionFailure(remoteResult)) {
      return remoteResult
    }

    const localFallbackResult = await runLocal()
    if (localFallbackResult.ok) {
      return {
        ...localFallbackResult,
        provider: 'local',
        fallbackFrom: 'jdoodle',
        remoteAttempted: Boolean(remoteResult?.remoteAttempted),
        remoteCreditEstimated: Number(remoteResult?.remoteCreditEstimated || 0),
      }
    }

    return {
      ...remoteResult,
      stderr: [
        String(remoteResult.stderr || '').trim(),
        String(localFallbackResult.stderr || '').trim(),
      ]
        .filter(Boolean)
        .join('\n\n--- Local fallback ---\n'),
    }
  }

  return runLocal()
}
