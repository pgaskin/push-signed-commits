import type { GitHubApiUrl, GitHubGraphqlUrl } from './github.ts'
import { EOL } from 'node:os'
import { Console } from 'node:console'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { repo } from './git.ts'
import { NotPushableError, commits, staged } from './commit.ts'
import {
  DefaultGitHubApi, DefaultGitHubGraphql,
  appJwt, getRepoInstallation, createInstallationToken, revokeInstallationToken,
  createCommitOnBranch,
} from './github.ts'

if (import.meta.main) {
  globalThis.console = new Console({
    stdout: process.stdout,
    stderr: process.stderr,
    colorMode: true,
  })
  await main()
}

export async function main(): Promise<void> {
  const cfg = {
    path: getInput('path') || '.',
    repository: getInput('repository'),
    branch: getInput('branch'),
    revision: getInput('revision'),
    allowEmpty: getBoolInput('allow-empty') ?? false,
    commitMessage: getFileInput('commit-message-file') ?? getInput('commit-message'),
    userAgent: getInput('user-agent'),
    insecureSkipVerify: getBoolInput('insecure-skip-verify') ?? false,
    dryRun: getBoolInput('dry-run') ?? false,
    githubToken: getInput('github-token'),
    githubApiUrl: getUrlInput('github-api-url') as GitHubApiUrl || DefaultGitHubApi,
    githubGraphqlUrl: getUrlInput('github-graphql-url') as GitHubGraphqlUrl || DefaultGitHubGraphql,
    appId: getInput('app-id'),
    appKey: getInput('app-key'),
    gitBinary: getInput('git-binary') || 'git',
  } as const

  if (cfg.insecureSkipVerify) {
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
  }

  const r = await repo(cfg.gitBinary, cfg.path)
  
}

function getUrlInput(name: string): string | undefined {
  const str = getInput(name)
  if (str !== '') {
    try {
      const u = new URL(str)
      if (u.protocol === '' || u.host === '') {
        throw new Error('Missing protocol/host')
      }
      return str
    } catch (err) {
      throw new Error(`Input ${name}: ${err}`)
    }
  }
  return
}

function getFileInput(name: string): string | undefined {
  const str = getInput(name)
  if (str !== '') {
    try {
      return readFileSync(str, { encoding: 'utf-8' })
    } catch (err) {
      throw new Error(`Input ${name}: ${err}`)
    }
  }
  return
}

function getBoolInput(name: string): boolean | undefined {
  const str = getInput(name)
  if (str !== '') {
    switch (str) {
      case '1': case 't': case 'T': case 'true': case 'TRUE': case 'True':
        return true
      case '0': case 'f': case 'F': case 'false': case 'FALSE': case 'False':
        return false
    }
    throw new Error(`Input ${name}: ${JSON.stringify(str)} is not a valid bool`)
  }
  return
}

// https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands

// actions/core@v3.0.0/src/core.ts, but simpler
export function getInput(name: string): string {
  const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`
  return process.env[key]?.trim() ?? ''
}

// actions/core@v3.0.0/src/core.ts, but simpler
export function beginGroup(name: string): Disposable {
  issueCommand('group', {}, name)
  return { [Symbol.dispose]() { issueCommand('endgroup', {}, '') } }
}

// actions/core@v3.0.0/src/core.ts
export const DEBUG = process.env['RUNNER_DEBUG'] === '1'

// actions/core@v3.0.0/src/core.ts, but simpler
export function setOutput(name: string, value: string): void {
  if (!issueFileCommand('OUTPUT', name, value)) {
    process.stdout.write(EOL)
    issueCommand("set-output", { name }, value)
  }
}

// actions/core@v3.0.0/src/command.ts, but simpler
export function issueCommand(command: string, properties: {[key: string]: any}, message: string): void {
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
  process.stdout.write(`::${command}${props}::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}${EOL}`)
}

// actions/core@v3.0.0/src/file-command.ts, but simpler
export function issueFileCommand(command: string, key: string, value: string): boolean {
  const path = process.env[`GITHUB_${command}`]
  if (path) {
    if (!existsSync(path)) {
      throw new Error(`Missing ${command} command file ${path}`)
    }
    const delim = `ghadelimiter_${randomUUID()}`
    if (key.includes(delim) || value.includes(delim)) {
      throw new Error(`Key/value includes random delimiter ${delim}`)
    }
    appendFileSync(path, `${key}<<${delim}${EOL}${value}${EOL}${delim}${EOL}`, { encoding: 'utf8' })
    return true
  }
  return false
}
