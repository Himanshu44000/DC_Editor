const normalizeProvider = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'local' || normalized === 'jdoodle' || normalized === 'hybrid') {
    return normalized
  }
  return 'hybrid'
}

const getExecutionProvider = () => normalizeProvider(process.env.DSA_EXECUTION_PROVIDER || 'hybrid')

const getJdoodleConfig = () => ({
  baseUrl: String(process.env.JDOODLE_BASE_URL || 'https://api.jdoodle.com').trim().replace(/\/+$/, ''),
  executePath: String(process.env.JDOODLE_EXECUTE_PATH || '/v1/execute').trim() || '/v1/execute',
  clientId: String(process.env.JDOODLE_CLIENT_ID || '').trim(),
  clientSecret: String(process.env.JDOODLE_CLIENT_SECRET || '').trim(),
  timeoutMs: Math.max(2000, Number(process.env.JDOODLE_TIMEOUT_MS || 20000)),
})

const getJdoodleRuntimeMap = () => ({
  javascript: {
    language: String(process.env.JDOODLE_JS_LANGUAGE || 'nodejs').trim() || 'nodejs',
    versionIndex: String(process.env.JDOODLE_JS_VERSION_INDEX || '7').trim() || '7',
  },
  python: {
    language: String(process.env.JDOODLE_PY_LANGUAGE || 'python3').trim() || 'python3',
    versionIndex: String(process.env.JDOODLE_PY_VERSION_INDEX || '6').trim() || '6',
  },
  cpp: {
    language: String(process.env.JDOODLE_CPP_LANGUAGE || 'cpp17').trim() || 'cpp17',
    versionIndex: String(process.env.JDOODLE_CPP_VERSION_INDEX || '3').trim() || '3',
  },
  java: {
    language: String(process.env.JDOODLE_JAVA_LANGUAGE || 'java').trim() || 'java',
    versionIndex: String(process.env.JDOODLE_JAVA_VERSION_INDEX || '6').trim() || '6',
  },
  typescript: {
    language: String(process.env.JDOODLE_TS_LANGUAGE || 'typescript').trim() || 'typescript',
    versionIndex: String(process.env.JDOODLE_TS_VERSION_INDEX || '1').trim() || '1',
  },
})

const hasCompilationFailure = (value) => {
  if (value === null || value === undefined || value === '') return false
  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    return numeric !== 0
  }
  return String(value).trim().toLowerCase() !== 'none'
}

export const resolveExecutionProvider = () => getExecutionProvider()

export const isJdoodleConfigured = () => {
  const config = getJdoodleConfig()
  return Boolean(config.clientId && config.clientSecret)
}

export const getJdoodleRuntimeTarget = (runtime) => {
  const normalizedRuntime = String(runtime || '').trim().toLowerCase()
  return getJdoodleRuntimeMap()[normalizedRuntime] || null
}

export const shouldUseRemoteExecutionPrimary = (runtime, provider = getExecutionProvider()) => {
  const resolvedProvider = normalizeProvider(provider)
  if (resolvedProvider === 'local') return false
  if (resolvedProvider === 'jdoodle') return true
  return String(runtime || '').trim().toLowerCase() !== 'javascript'
}

export const isInfrastructureLikeExecutionFailure = (result) => {
  if (!result || result.ok) return false

  const category = String(result.errorCategory || '').trim().toLowerCase()
  if (category === 'provider_unavailable' || category === 'network_error') {
    return true
  }

  const stderr = String(result.stderr || '').toLowerCase()
  return (
    stderr.includes('not recognized') ||
    stderr.includes('enoent') ||
    stderr.includes('docker execution error') ||
    stderr.includes('spawn') ||
    stderr.includes('connect') ||
    stderr.includes('network') ||
    stderr.includes('timed out')
  )
}

export const executeWithJdoodle = async ({ runtime, sourceCode, stdin = '', timeoutMs = null }) => {
  const config = getJdoodleConfig()
  const resolvedTimeoutMs = Math.max(2000, Number(timeoutMs) || config.timeoutMs)
  const target = getJdoodleRuntimeTarget(runtime)

  if (!isJdoodleConfigured()) {
    return {
      ok: false,
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: 'JDoodle is not configured. Set JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET.',
      provider: 'jdoodle',
      remoteAttempted: false,
      remoteCreditEstimated: 0,
      cacheable: false,
      errorCategory: 'provider_unavailable',
    }
  }

  if (!target) {
    return {
      ok: false,
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: `JDoodle does not support runtime mapping for "${runtime}" in current configuration.`,
      provider: 'jdoodle',
      remoteAttempted: false,
      remoteCreditEstimated: 0,
      cacheable: false,
      errorCategory: 'runtime_not_supported',
    }
  }

  const endpoint = `${config.baseUrl}${config.executePath.startsWith('/') ? '' : '/'}${config.executePath}`
  const payload = {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    script: String(sourceCode || ''),
    stdin: String(stdin || ''),
    language: target.language,
    versionIndex: String(target.versionIndex),
    compileOnly: false,
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), resolvedTimeoutMs)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    let body = null
    try {
      body = await response.json()
    } catch {
      body = null
    }

    if (!response.ok) {
      const message =
        String(body?.error || body?.message || '').trim() ||
        (response.status === 429
          ? 'JDoodle daily API limit reached.'
          : `JDoodle request failed with status ${response.status}.`)

      return {
        ok: false,
        exitCode: 1,
        timedOut: false,
        stdout: '',
        stderr: message,
        provider: 'jdoodle',
        remoteAttempted: true,
        remoteCreditEstimated: 1,
        cacheable: false,
        errorCategory: response.status === 429 ? 'rate_limited' : 'network_error',
        statusCode: response.status,
      }
    }

    const output = String(body?.output || '')
    const statusCode = Number(body?.statusCode || response.status || 500)
    const timedOut = /jdoodle\s*-\s*timeout/i.test(output)
    const compilationFailed = hasCompilationFailure(body?.compilationStatus) || body?.isCompiled === false || body?.isCompiled === 0
    const executionFailed = body?.isExecutionSuccess === false || body?.isExecutionSuccess === 0
    const explicitError = String(body?.error || '').trim()

    const ok = statusCode === 200 && !timedOut && !compilationFailed && !executionFailed && !explicitError

    return {
      ok,
      exitCode: ok ? 0 : 1,
      timedOut,
      stdout: ok ? output : '',
      stderr: ok ? '' : output || explicitError || 'Execution failed on JDoodle.',
      provider: 'jdoodle',
      remoteAttempted: true,
      remoteCreditEstimated: 1,
      cacheable: statusCode !== 429,
      errorCategory: timedOut
        ? 'timeout'
        : statusCode === 429
          ? 'rate_limited'
          : ok
            ? null
            : 'runtime_error',
      statusCode,
      memory: body?.memory ?? null,
      cpuTime: body?.cpuTime ?? null,
      jdoodleLanguage: target.language,
      jdoodleVersionIndex: String(target.versionIndex),
    }
  } catch (error) {
    const isAbort = error?.name === 'AbortError'
    return {
      ok: false,
      exitCode: 1,
      timedOut: isAbort,
      stdout: '',
      stderr: isAbort
        ? 'JDoodle request timed out.'
        : `JDoodle request failed: ${error?.message || 'Unknown error'}`,
      provider: 'jdoodle',
      remoteAttempted: false,
      remoteCreditEstimated: 0,
      cacheable: false,
      errorCategory: isAbort ? 'timeout' : 'network_error',
    }
  } finally {
    clearTimeout(timer)
  }
}
