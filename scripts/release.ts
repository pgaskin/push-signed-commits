#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const usage = await (async () => {
  delete process.env['ACTIONS_ORCHESTRATION_ID'] // so it doesn't pollute the help text
  const cli = await import('../lib/cmd/cli.ts')
  return cli.usage
})()

function main() {
  console.log(`Parsing package.json`)
  const obj = JSON.parse(readFileSync('package.json', 'utf-8'))
  const repo = obj.repository?.url?.replace(/^(git\+)?https:\/\/github\.com\//, '').replace(/\.git$/, '') ?? ''

  console.log("Parsing inputs/outputs from action.yml")
  const action: Record<'inputs' | 'outputs', Record<string, { lines: string[], default?: string }>> = { inputs: {}, outputs: {} }
  updateFile('action.yml', (contents, eol) => {
    let section: 'inputs' | 'outputs' | null = null
    let name = ''
    let lines: string[] = []
    let def: string | undefined
    let inDesc = false
    function flush() {
      if (name && section) action[section][name] = { lines, ...(def !== undefined ? { default: def } : {}) }
      name = ''; lines = []; def = undefined; inDesc = false
    }
    for (const line of readFileSync('action.yml', 'utf-8').split(eol)) {
      if (line === 'inputs:') { flush(); section = 'inputs'; continue }
      if (line === 'outputs:') { flush(); section = 'outputs'; continue }
      if (!section || (!line.startsWith(' ') && line !== '')) { if (!line.startsWith(' ') && line !== '') section = null; continue }
      const indent = line.length - line.trimStart().length
      const trimmed = line.trimStart()
      if (indent === 2) { flush(); name = trimmed.replace(/:$/, ''); continue }
      if (indent === 4) {
        inDesc = false
        if (trimmed.startsWith('description:')) { const v = trimmed.slice('description:'.length).trim(); lines = v ? [v] : []; inDesc = true }
        else if (trimmed.startsWith('default:')) { def = trimmed.slice('default:'.length).trim() }
        continue
      }
      if (indent >= 6 && inDesc) { lines.push(trimmed); continue }
      inDesc = false
    }
    flush()
    return contents
  })
  if (!Object.keys(action.inputs).length || !Object.keys(action.outputs).length) throw new Error(`Failed to parse action.yml`)

  console.log(`Parsing version`)
  if (!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) throw new Error(`Failed to extract github repository from package.json`)
  const version = process.argv[2] ?? `v${obj.version}`
  const versionRe = `v[0-9]+[.][0-9]+[.][0-9]+`
  if (!version || !(new RegExp(`^${versionRe}$`)).test(version)) throw new Error(`Invalid version ${versionRe}`)

  console.log()
  console.log(`Releasing ${repo}@${version}`)

  console.log("Updating README")
  updateFile('README.md', (readme, eol) => {
    if (!(new RegExp(`${repo}@v`, 'i')).test(readme)) throw new Error(`No action references found in README`)
    if (!(new RegExp(`${obj.name}@v`, 'i')).test(readme)) throw new Error(`No npm package references found in README`)
    readme = readme.replace(new RegExp(`(${repo}@)${versionRe}`, 'gi'), `$1${version}`) // action vX.Y.Z
    readme = readme.replace(new RegExp(`(${repo}@)v[0-9]+(?![.][0-9])`, 'gi'), `$1${version.split('.')[0]}`) // action vX
    readme = readme.replace(new RegExp(`(?<!/)(${obj.name}@)${versionRe}`, 'gi'), `$1${version}`) // npm vX.Y.Z
    readme = readme.replace(new RegExp(`(?<!/)(${obj.name}@)v[0-9]+(?![.][0-9])`, 'gi'), `$1${version.split('.')[0]}`) // npm vX
    readme = readme.replace(new RegExp(`(?<!/)(${obj.name}@)${versionRe.slice(1)}`, 'gi'), `$1${version.slice(1)}`) // npm X.Y.Z
    readme = readme.replace(new RegExp(`(?<!/)(${obj.name}@)[0-9]+(?![.][0-9])`, 'gi'), `$1${version.split('.')[0].slice(1)}`) // npm X
    readme = updatePlaceholder(readme, eol, 'inputs', [
      '```yaml',
      `- uses: ${repo}@${version}`,
      `  with:`,
      ...Object.entries(action.inputs).map(([k, v]) => [
        ``,
        ...v.lines.map(l => '    # ' + l),
        `    ${k}: ${/^(true|false|\d+|\$\{\{.+\}\})$/.test(v.default ?? '') ? v.default : `'${v.default ?? ''}'`}`,
      ].join(eol)),
      '```',
    ].join(eol))
    readme = updatePlaceholder(readme, eol, 'outputs', [
      ...Object.entries(action.outputs).map(([k, v]) => [
        `- \`${k}\` \\`,
        ...v.lines.map(l => '  ' + l),
      ].join(eol)),
    ].join(`${eol}${eol}`))
    readme = updatePlaceholder(readme, eol, 'cli', [
      '```',
      usage(`npx -y ${obj.name}@${version}`, eol),
      '```',
    ].join(eol))
    return readme
  })

  console.log("Updating package.json version")
  updateFile('package.json', (pkg, eol) => {
    return pkg.split(eol).map(x => x.includes('"version"') ? x.replace(new RegExp(versionRe.slice(1)), version.slice(1)) : x).join(eol)
  })

  console.log("Updating package-lock.json metadata")
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], { stdio: 'inherit', shell: true }) // shell is needed on windows
}

function updateFile(filename: string, fn: (contents: string, eol: string) => string) {
  const updateFile = readFileSync(filename, 'utf-8')
  const eol = /\r?\n|\r/.exec(updateFile)?.[0]
  if (!eol || updateFile.split(eol).length < 2) {
    throw new Error(`Failed to detect EOL for ${fn}`)
  }
  writeFileSync(filename, fn(updateFile, eol))
}

function updatePlaceholder(contents: string, eol: string, name: string, replacement: string): string {
  const s = `${eol}${eol}<!--{${name}}-->${eol}${eol}`
  const e = `${eol}${eol}<!--{/${name}}-->${eol}${eol}`
  const i = contents.indexOf(s)
  if (i < 0) {
    throw new Error(`Missing placeholder start for ${name}`)
  }
  const j = contents.indexOf(e)
  if (i < 0) {
    throw new Error(`Missing placeholder end for ${name}`)
  }
  if (j < i) {
    throw new Error(`Placeholder ${name} ends before it starts`)
  }
  if (replacement.includes(s) || replacement.includes(e)) {
    throw new Error(`Replacement contains placeholder ${name}`)
  }
  return `${contents.slice(0, i+s.length)}${replacement}${contents.slice(j)}`
}

if (import.meta.main) {
  main()
}
