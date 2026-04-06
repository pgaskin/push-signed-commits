import child_process from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function main() {
  console.log(await findLatestGo())
}

async function findLatestGo(): Promise<string | undefined> {
  let maxVersion: string | undefined
  let maxRoot: string | undefined
  let maxMajor: number | undefined
  let maxMinor: number | undefined
  for await (const tc of goToolchains()) {
    const ver = tc.GOVERSION.match(/^go1\.([0-9]+)(?:\.([0-9])+)?([a-z0-9]+)?(-\S+)?(?:\s|$)/)
    if (!ver) {
      if (DEBUG) {
        console.warn(`warning: skipping toolchain ${tc.GOROOT} with unparseable GOVERSION ${tc.GOVERSION}`)
      }
      continue
    }
    const major = 1
    const minor = parseInt(ver[1])
    const patch = parseInt(ver[2] || '0')
    const pre = !!ver[3]
    const custom = !!ver[4]
    if (pre) {
      if (DEBUG) {
        console.warn(`warning: skipping toolchain ${tc.GOROOT} with pre-release GOVERSION ${tc.GOVERSION}`)
      }
      continue
    }
    if (DEBUG) {
      console.log(`info: found go toolchain ${tc.GOROOT} with version ${JSON.stringify({major, minor, patch, pre, custom})}`)
    }
    if (maxVersion && major < maxMajor! || (major === maxMajor && minor < maxMinor!)) {
      continue
    }
    maxVersion = tc.GOVERSION
    maxRoot = tc.GOROOT
    maxMajor = major
    maxMinor = minor
  }
  if (maxVersion) {
    if (DEBUG) {
      console.log(`selected latest go toolchain ${maxRoot} (version: ${maxVersion})`)
    }
    return maxRoot
  }
  return
}

async function *goToolchains(): AsyncGenerator<GoEnv> {
  try {
    yield goEnv()
  } catch (err) {
    console.warn(`warning: failed to get system go toolchain info from default go install: ${err}`)
  }
  yield* cachedGoVersions()
}

/**
 * Yields all go versions in the runner tool cache. Ignores ones where
 * {@link goEnv} fails.
 *
 * Based on logic in:
 * - actions/tool-cache@v4.0.0/src/tool-cache.ts
 * - actions/setup-go@v6.4.0/src/installer.ts
 * - actions/setup-go@v6.4.0/src/main.ts
 */
async function *cachedGoVersions(): AsyncGenerator<GoEnv> {
  const cacheDirectory = process.env['AGENT_TOOLSDIRECTORY'] || process.env['RUNNER_TOOL_CACHE']
  if (!cacheDirectory) {
    return
  }

  const tool = 'go'
  const arch = os.arch()

  for (const version of await fs.readdir(path.join(cacheDirectory, tool))) {
    const dir = path.join(cacheDirectory, tool, version, arch)
    try {
      const stat = await fs.stat(dir)
      if (!stat.isDirectory()) {
        continue
      }
      yield await goEnv(goCmd(dir))
    } catch (err) {
      if (DEBUG) {
        console.warn(`warning: failed to get go toolchain info from ${dir}: ${err}`)
      }
      continue
    }
  }
}

/**
 * Gets the path to the go command in a GOROOT.
 */
function goCmd(goroot: string): string {
  return path.join(goroot, 'bin', withExeSuffix('go'))
}

/**
 * Go toolchain environment variables.
 */
type GoEnv = {
  [key in (typeof GOENV_NONEMPTY_VARS)[number]]: string;
}

const GOENV_NONEMPTY_VARS = ['GOROOT', 'GOVERSION'] as const

/**
 * Gets the Go environment variables.
 */
async function goEnv(exe: string = 'go'): Promise<GoEnv> {
  const env = await go(true, exe, 'env', '-json') as GoEnv
  for (const key of GOENV_NONEMPTY_VARS) {
    if (key in env && typeof env[key] === 'string' && env[key]) {
      continue
    }
    throw new Error(`go env missing ${key}`)
  }
  return env
}

/**
 * Runs the go command, returning stdout, and throwing an error with the
 * contents of stderr if it fails. Also adds some env vars to ensure consistent
 * behaviour.
 */
function go<T extends boolean>(json: T, exe: string, ...args: string[]): Promise<T extends true ? any : string> {
  if (DEBUG) {
    console.log(`# ${exe} ${args.map(a => JSON.stringify(a)).join(" ")}`)
  }
  return new Promise((resolve, reject) => {
    const child = child_process.spawn(exe, args, {
      env: {
        ...process.env,
        GOTOOLCHAIN: 'local',
        GOCACHEPROG: '',
        GOPROXY: 'off',
        GOVCS: 'off',
      },
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', err => reject(err))
    child.on('close', (code, signal) => {
      if (code) reject(new Error(`${exe} ${JSON.stringify(args)}: exit status ${code} (stderr: ${Buffer.concat(stderr).toString('utf-8')})`))
      else if (signal) reject(new Error(`${exe} ${JSON.stringify(args)}: killed with ${signal} (stderr: ${Buffer.concat(stderr).toString('utf-8')})`))
      const str = Buffer.concat(stdout).toString('utf-8')
      if (json) {
        try {
          resolve(JSON.parse(str) as any)
        } catch (err) {
          reject(new Error(`go ${JSON.stringify(args)}: failed to parse output ${JSON.stringify(str)} as json`))
        }
      } else {
        resolve(str as any)
      }
    })
  })
}

/**
 * Appends the Go executable suffix for the current platform.
 * 
 * Based on logic in:
 * - go@v1.26.1/src/cmd/go/internal/cfg/cfg.go
 */
function withExeSuffix(name: string): string {
  const goexe = os.platform() == 'win32' ? '.exe' : ''
  return name + goexe
}

/**
 * Whether we're in debug mode.
 *
 * Based on logic in:
 * - actions/core@v3.0.0/src/core.ts
 */
const DEBUG = process.env['RUNNER_DEBUG'] === '1'

await main()
