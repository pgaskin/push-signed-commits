import type { OID } from './git.ts'
import type { CommittableBranch, CreateCommitOnBranchInput, GitHubApiUrl, GitHubGraphqlUrl, GitHubToken } from './github.ts'
import { EOL } from 'node:os'
import { Console } from 'node:console'
import { createPrivateKey, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { styleText } from 'node:util'
import { exit, env, stdout, stderr } from 'node:process'
import { repo } from './git.ts'
import { NotPushableError, commits, staged } from './commit.ts'
import {
  DefaultGitHubApi, DefaultGitHubGraphql, setUserAgent,
  appJwt, getRepoInstallation, createInstallationToken, revokeInstallationToken,
  createCommitOnBranch,
} from './github.ts'

export class ActionInputError extends Error {
  readonly key: string

  constructor(key: string, message: string) {
    super(`Input ${key}: ${message}`)
    this.name = 'ActionInputError'
    this.key = key
  }
}

export async function main(): Promise<void> {
  const input = {
    path: getInput('path') || '.',
    repository: getInput('repository'),
    branch: getInput('branch'),
    revision: getInput('revision'),
    allowEmpty: getBoolInput('allow-empty') ?? false,
    commitMessage: getFileInput('commit-message-file') ?? getInput('commit-message'),
    userAgent: getInput('user-agent'),
    insecureSkipVerify: getBoolInput('insecure-skip-verify') ?? false,
    dryRun: getBoolInput('dry-run') ?? false,
    githubToken: getInput('github-token') as GitHubToken,
    githubApiUrl: getUrlInput('github-api-url') as GitHubApiUrl || env['GITHUB_API_URL'] as GitHubApiUrl || DefaultGitHubApi,
    githubGraphqlUrl: getUrlInput('github-graphql-url') as GitHubGraphqlUrl || env['GITHUB_GRAPHQL_URL'] as GitHubGraphqlUrl || DefaultGitHubGraphql,
    appId: getInput('app-id'),
    appKey: getInput('app-key'),
    gitBinary: getInput('git-binary') || 'git',
  }

  if (input.repository == '') {
    throw new ActionInputError('repository', 'must not be empty')
  }
  if (!/.[/]./.test(input.repository)) {
    throw new ActionInputError('repository', 'must be in username/repo format')
  }
  if (input.branch.startsWith('refs/tags/')) {
    throw new ActionInputError('branch', 'must not be a tag')
  }
  if (input.branch == '') {
    throw new ActionInputError('branch', 'must not be empty')
  }
  if (input.appId != '' && input.appKey == '') {
    throw new ActionInputError('app-key', 'required if app-id is set')
  }
  if (input.appId == '' && input.githubToken == '') {
    throw new ActionInputError('github-token', 'required if app-id is not set')
  }
  if (input.appId != '' && !/^[0-9]+$/.test(input.appId)) {
    throw new ActionInputError('app-id', 'not a valid integer')
  }
  if (input.appKey != '') {
    input.appKey = input.appKey.replaceAll('\\n', '\n')
    if (/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/.test(input.appKey)) {
      input.appKey = Buffer.from(input.appKey, 'base64').toString('utf-8')
    }
  }

  let revoke = false
  const output = {
    notPushable: false,
    pushedOids: [] as string[],
    pushedOid: '',
    localCommitOids: [] as string[],
    localCommitOid: '',
  }
  try {
    const r = await repo(input.gitBinary, input.path)
    if (input.insecureSkipVerify) {
      env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
    }
    if (input.userAgent != '') {
      setUserAgent(input.userAgent)
    }

    if (!input.dryRun && input.appId != '') {
      let key
      try {
        key = createPrivateKey({
          key: input.appKey,
          format: 'pem',
        })
      } catch (err) {
        throw new ActionInputError('app-key', 'failed to parse app private rsa key')
      }
      try {
        const jwt = appJwt(parseInt(input.appId, 10), key)
        console.log(`Getting app ${input.appId} installation for repo ${input.repository}`)
        const installID = await getRepoInstallation(input.githubApiUrl, jwt, input.repository)
        console.log(`Generating app token for app ${input.appId} installation ${installID}`)
        input.githubToken = await createInstallationToken(input.githubApiUrl, jwt, input.repository, installID)
        console.log(`Have app installation token`)
        revoke = true
      } catch (err) {
        throw new Error(`Failed to create app installation token for repo ${input.repository}: ${err}`)
      }
      console.log()
    }

    console.log(`Repo ${r.gitDir}`)
    const branch: CommittableBranch = {
      repositoryNameWithOwner: input.repository,
      branchName: input.branch,
    }
    const logCommit = (input: Omit<CreateCommitOnBranchInput, 'branch'>) => {
      console.log(styleText('gray', `  ^ ${input.expectedHeadOid}`))
      console.log(styleText('gray', `  # subject: ${JSON.stringify(input.message.headline)}`))
      if (input.message.body != '') {
        console.log(styleText('gray', `  # body ${JSON.stringify(input.message.body)}`))
      }
      for (const f of input.fileChanges.additions) {
        console.log(styleText('gray', `  + ${f.path} (${Buffer.from(f.contents, 'base64').length} bytes = ${f.contents.length} enc)`))
      }
      for (const f of input.fileChanges.deletions) {
        console.log(styleText('gray', `  - ${f.path}`))
      }
    }
    if (input.revision == '') {
      const commit = await staged(r, input.commitMessage)
      if (!input.allowEmpty && commit.input.fileChanges.additions.length === 0 && commit.input.fileChanges.deletions.length === 0) {
        console.log(`${styleText('yellow', `No changes to commit from staging area`)}`)
        return
      }
      console.log()
      console.log(`${styleText('cyan', `${input.dryRun ? `Would push` : `Pushing`} new commit from staging area over ${branch.repositoryNameWithOwner}:${branch.branchName}@${commit.input.expectedHeadOid}`)}`)
      logCommit(commit.input)
      if (!input.dryRun) {
        const oid = await createCommitOnBranch(input.githubGraphqlUrl, input.githubToken, {branch, ...commit.input})
        output.pushedOids.push(oid)
        output.pushedOid = oid
        console.log(`${styleText('green', `  = ${oid}`)}`)
      }
    } else {
      let prev: OID | undefined
      for await (const commit of commits(r, input.revision)) {
        if (prev) {
          commit.input.expectedHeadOid = prev
        }
        console.log()
        console.log(`${styleText('cyan', `${input.dryRun ? `Would push` : `Pushing`} commit ${commit.local} over ${branch.repositoryNameWithOwner}:${branch.branchName}@${commit.input.expectedHeadOid}`)}`)
        logCommit(commit.input)
        if (!input.dryRun) {
          const oid = await createCommitOnBranch(input.githubGraphqlUrl, input.githubToken, {branch, ...commit.input})
          output.pushedOids.push(oid)
          output.pushedOid = oid
          prev = oid
          console.log(`${styleText('green', ` = ${oid}`)}`)
        } else {
          prev = commit.local!.replace(/./g, '?') as OID
        }
        output.localCommitOids.push(commit.local!)
        output.localCommitOid = commit.local!
      }
      if (prev === undefined) {
        console.log(`${styleText('yellow', `No commits to push from ${input.revision}`)}`)
        return
      }
    }
  } catch (err) {
    if (err instanceof NotPushableError) {
      output.notPushable = true
    }
    throw err
  } finally {
    setOutput('not-pushable', JSON.stringify(output.notPushable))
    if (!input.dryRun) {
      setOutput('pushed-oids', output.pushedOids.join(' '))
      setOutput('pushed-oid', output.pushedOid)
    }
    if (input.revision != '') {
      setOutput('local-commit-oids', output.localCommitOids.join(' '))
      setOutput('local-commit-oid', output.localCommitOid)
    }
    if (revoke) {
      console.log()
      try {
        console.log(`Revoking app installation token`)
        await revokeInstallationToken(input.githubApiUrl, input.githubToken)
        console.log(`Revoked app installation token`)
      } catch (err) {
        console.log(styleText('yellow', `Failed to revoke app installation token, continuing anyways: ${err}`))
      }
    }
  }
}

function getUrlInput(name: string): string | undefined {
  const str = getInput(name)
  if (str !== '') {
    try {
      const u = new URL(str)
      if (u.protocol === '' || u.host === '') {
        throw 'Missing protocol/host'
      }
      return str
    } catch (err) {
      throw new ActionInputError(name, `${err}`)
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
      throw new ActionInputError(name, `${err}`)
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
    throw new ActionInputError(name, `invalid bool ${JSON.stringify(str)}`)
  }
  return
}

// https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands

// actions/core@v3.0.0/src/core.ts, but simpler
function getInput(name: string): string {
  const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`
  return env[key]?.trim() ?? ''
}

// actions/core@v3.0.0/src/core.ts, but simpler
function setOutput(name: string, value: string): void {
  if (!issueFileCommand('OUTPUT', name, value)) {
    stdout.write(EOL)
    issueCommand("set-output", { name }, value)
  }
}

// actions/core@v3.0.0/src/command.ts, but simpler
function issueCommand(command: string, properties: {[key: string]: any}, message: string): void {
  let props = ''
  if (properties) {
    for (const [key, val] of Object.entries(properties)) {
      if (val) {
        if (props) {
          props += ','
        } else {
          props += ' '
        }
        props += `${key}=${val.toString().replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A').replaceAll(':', '%3A').replaceAll(',', '%2C')}`
      }
    }
  }
  stdout.write(`::${command}${props}::${message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}${EOL}`)
}

// actions/core@v3.0.0/src/file-command.ts, but simpler
function issueFileCommand(command: string, key: string, value: string): boolean {
  const path = env[`GITHUB_${command}`]
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

if (import.meta.main) {
  globalThis.console = new Console({
    stdout: stderr,
    stderr: stderr,
    colorMode: true,
  })
  try {
    await main()
    exit(0)
  } catch (err) {
    if (err instanceof Error) {
      console.log(`${styleText(['red', 'bold'], `${err.name}:`)} ${styleText('red', err.message)}`)
    } else {
      console.log(`${styleText(['red', 'bold'], `Error:`)} ${styleText('red', `${err}`)}`)
    }
    exit(1)
  }
}
