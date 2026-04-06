import child_process from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Console } from 'node:console'
import { styleText } from 'node:util'

globalThis.console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  colorMode: true,
})

async function main() {
  try {
    return await run(import.meta.dirname)
  } catch (err) {
    console.error(`internal error: ${err}`)
    return 1
  }
}

async function run(module: string, ...args: string[]): Promise<number> {
  await using out = await build(module)
  if (DEBUG) {
    console.log(`info: running ${out.path}`)
  }
  return await new Promise((resolve, reject) => {
    const child = child_process.spawn(out.path, args, {
      stdio: 'inherit',
    })
    child.on('error', err => reject(err))
    child.on('close', (code, signal) => {
      if (signal) reject(new Error(`killed by signal ${signal}`))
      resolve(code || 0)
    })
  })
}

async function build(module: string) {
  using _group = ghaGroup('Build')

  const go = await findLatestGo()
  if (!go) {
    throw new Error(`no suitable go toolchains found in PATH or agent tool cache${SELFHOSTED ? ` (since you're on a self-hosted runer, you may need to install Go yourself)` : ``}`)
  }
  if (DEBUG) {
    console.log(`selected latest go toolchain ${go.root} (version: ${go.version})`)
  }

  const gomod = await parseGoMod(path.join(module, 'go.mod'))
  if (gomod.minor > go.minor! || (gomod.minor === go.minor && gomod.patch > go.patch!)) {
    throw new Error(`latest go toolchain ${go.root} is too old for ${gomod.path} (wanted at least 1.${gomod.minor}.${gomod.patch}, got ${go.version})`)
  }

  const name = gomod.path.replace(/^.+\//, '')
  const outdir = await fs.mkdtemp(path.join(os.tmpdir(), 'push-signed-commits-'))
  const out = path.join(outdir, withExeSuffix(name))

  if (DEBUG) {
    console.log(`Building ${gomod.path} to ${out} with ${go.root} (${go.version})`)
  } else {
    console.log(`Building ${gomod.path} with ${go.root} (${go.version})`)
  }
  try {
    await runGo(false, goCmd(go.root), 'build', '-C', module, '-mod=readonly', '-trimpath', '-ldflags', '-X main.version=action', '-tags', 'gha', '-o', out)
  } catch (err) {
    throw new Error(`failed to build ${gomod.path} with ${go.root} (${go.version}): ${err}}`)
  }
  console.log(`Built ${out}`)
  // TODO: cache?

  return {
    path: out,
    goversion: go.version,
    async [Symbol.asyncDispose]() {
      try {
        await fs.rm(out)
        await fs.rmdir(outdir)
      } catch (err) {
        if (DEBUG) {
          console.warn(`warning: failed to remote ${outdir}: ${err}`)
        }
      }
    }
  }
}

/**
 * Extract the module and go directives from a go.mod file.
 */
async function parseGoMod(modfile: string) {
  const gomod = await fs.readFile(modfile, {
    encoding: 'utf-8',
  })

  const gomodpathMatch = gomod.match(/^module\s*(.+)$/m)
  if (!gomodpathMatch) {
    throw new Error(`failed to parse go module path from go.mod file ${modfile}`)
  }
  const path = gomodpathMatch[1]

  const gomodver = gomod.match(/^go\s*1\.([0-9]+)(?:\.([0-9])+)?(?:\s|$)/m)
  if (!gomodver) {
    throw new Error(`failed to parse go version from go.mod file ${modfile}`)
  }
  if (DEBUG) {
    console.log(`info: parsed go.mod (path: ${path}, go version: ${gomodver}`)
  }
  return {
    path,
    major: 1,
    minor: parseInt(gomodver[1]),
    patch: parseInt(gomodver[2] || '0'),
   }
}

/**
 * Find the latest available go toolchain.
 */
async function findLatestGo() {
  console.log('Looking for latest Go toolchain')
  console.group()
  using _group = {[Symbol.dispose]() { console.groupEnd() }}

  let maxVersion: string | undefined
  let maxRoot: string | undefined
  let maxMinor: number | undefined
  let maxPatch: number | undefined
  for await (const tc of goToolchains()) {
    console.log(`${tc.GOROOT} (${tc.GOVERSION})`)
    console.group()
    using _group = {[Symbol.dispose]() { console.groupEnd() }}
    const ver = tc.GOVERSION.match(/^go1\.([0-9]+)(?:\.([0-9])+)?([a-z0-9]+)?(-\S+)?(?:\s|$)/)
    if (!ver) {
      console.warn(styleText('yellow', `Skipping toolchain due to unparseable GOVERSION`))
      continue
    }
    const minor = parseInt(ver[1])
    const patch = parseInt(ver[2] || '0')
    const pre = !!ver[3]
    // @ts-ignore
    const custom = !!ver[4]
    if (pre) {
      console.warn(styleText('yellow', `Skipping toolchain due to pre-release GOVERSION`))
      continue
    }
    if (maxVersion && minor < maxMinor! || (minor === maxMinor && patch < maxPatch!)) {
      continue
    }
    maxVersion = tc.GOVERSION
    maxRoot = tc.GOROOT
    maxMinor = minor
    maxPatch = patch
  }
  return !maxRoot ? undefined : {
    root: maxRoot as string,
    version: maxVersion as string,
    major: 1,
    minor: maxMinor as number,
    patch: maxPatch as number,
  }
}

async function *goToolchains(): AsyncGenerator<GoEnv> {
  const override = getInput('go-binary')
  if (override) {
    try {
      yield goEnv(override)
    } catch (err) {
      console.warn(styleText('yellow', `Failed to get go toolchain info from overridden go-binary ${override}: ${err}`))
    }
    return
  }
  try {
    yield goEnv()
  } catch (err) {
    if (typeof err !== 'object' || err == null || !('code' in err) || err.code !== 'ENOENT') {
      console.warn(styleText('yellow', `Failed to get go toolchain info from default go install: ${err}`))
    }
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
      console.error(styleText('yellow', `Failed to get go toolchain info from ${dir}: ${err}`))
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
  const env = await runGo(true, exe, 'env', '-json') as GoEnv
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
function runGo<T extends boolean>(json: T, exe: string, ...args: string[]): Promise<T extends true ? any : string> {
  if (DEBUG) {
    console.log(`# ${exe} ${args.map(a => JSON.stringify(a)).join(' ')}`)
  }
  return new Promise((resolve, reject) => {
    const child = child_process.spawn(exe, args, {
      env: {
        ...process.env,
        GOTOOLCHAIN: 'local',
        GOCACHEPROG: '',
        GOPROXY: 'off',
        GOVCS: 'off',
        GOWORK: 'off',
        CGO_ENABLED: '0',
        GOFLAGS: '-buildvcs=false',
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
 * Create an expandable group in the output for the current scope.
 */
function ghaGroup(name: string): Disposable {
  ghaCommand('group', {}, name)
  return {
    [Symbol.dispose]() {
      ghaCommand('endgroup', {}, '')
    }
  }
}

/**
 * Emits a command for GitHub Actions.
 *
 * Based on logic in:
 * - actions/core@v3.0.0/src/command.ts
 * - https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
 */
function ghaCommand(command: string, properties: {[key: string]: any}, message: string) {
  let props = ''
  if (properties) {
    for (const [key, val] of Object.entries(properties)) {
      if (val) {
        if (props) {
          props += ','
        } else {
          props += ' '
        }
        props += `${key}=${val.toString().replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C')}`
      }
    }
  }
  process.stdout.write(`::${command}${props}::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}${os.EOL}`)
}

/**
 * Get an action input.
 *
 * Based on logic in:
 * - actions/core@v3.0.0/src/core.ts
 */
function getInput(name: string, trim: boolean = false): string {
  const val: string = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || ''
  return trim ? val.trim() : val
}

/**
 * Whether we're in debug mode.
 *
 * Based on logic in:
 * - actions/core@v3.0.0/src/core.ts
 */
const DEBUG = process.env['RUNNER_DEBUG'] === '1'

/**
 * Whether the runner is self-hosted.
 *
 * Based on logic in:
 * - actions/setup-go@v6.4.0/src/utils.ts
 */
const SELFHOSTED = process.env['RUNNER_ENVIRONMENT'] !== 'github-hosted' && (process.env['AGENT_ISSELFHOSTED'] === '1' || process.env['AGENT_ISSELFHOSTED'] === undefined)

process.exit(await main())
