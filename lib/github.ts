import type { KeyObject } from 'node:crypto'
import type { OID } from './git.ts'
import { createSign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A GitHub token. */
export type GitHubToken = string & { __token: true }

/** The GitHub REST API base URL. */
export type GitHubApiUrl = string & { __ghapi: true }

/** The GitHub GraphQL API base URL. */
export type GitHubGraphqlUrl = string & { __ghgqlapi: true }

export const DefaultGitHubApi = 'https://api.github.com' as GitHubApiUrl
export const DefaultGitHubGraphql = 'https://api.github.com/graphql' as GitHubGraphqlUrl
export const DefaultUserAgent = await defaultUserAgent()

let userAgent = DefaultUserAgent

/** Sets the user agent used for requests. */
export function setUserAgent(ua: string): void {
  userAgent = ua || DefaultUserAgent
}

async function defaultUserAgent(): Promise<string> {
  const json = await readFile(join(import.meta.dirname, '..', 'package.json'))
  const pkg = JSON.parse(json.toString('utf-8'))
  let ua = `${pkg.name}`
  if (process.env['GITHUB_ACTIONS']) {
    ua += ' github-actions (' + [
      `runner-environment=${process.env['RUNNER_ENVIRONMENT']}`,
      `action=${process.env['GITHUB_ACTION']}`,
      `run-id=${process.env['GITHUB_RUN_ID']}`,
      `actor-id=${process.env['GITHUB_ACTOR_ID']}`,
    ].join('; ') + ')'
  }
  return ua
}

/** Creates a signed GitHub App JWT. */
export function appJwt(appId: number, rsaKey: KeyObject): GitHubToken {
  const header = Buffer.from(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT',
  })).toString('base64url')

  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 60,
    iss: String(appId),
  })).toString('base64url')

  const sign = createSign('RSA-SHA256')
  sign.update(`${header}.${payload}`)
  const signature = sign.sign(rsaKey, 'base64url')

  return `${header}.${payload}.${signature}` as GitHubToken
}

/** Get the GitHub App installation ID for repo. */
export async function getRepoInstallation(gh: GitHubApiUrl, jwt: GitHubToken, repo: string): Promise<number> {
  const [resp, text] = await request(gh, jwt, 'GET', `repos/${repo}/installation`)
  if (resp.status !== 200) {
    throw new Error(json`Response status ${resp.status} (body: ${text})`)
  }
  const obj = JSON.parse(text) as {
    id: number,
  }
  if (typeof obj?.id !== 'number') {
    throw new Error(json`Response missing installation id`)
  }
  return obj.id
}

/** Create a GitHub App installation token for installId with contents:write permission on repo. */
export async function createInstallationToken(gh: GitHubApiUrl, jwt: GitHubToken, repo: string, installId: number): Promise<GitHubToken> {
  const [resp, text] = await request(gh, jwt, 'POST', `app/installations/${installId}/access_tokens`, {
    repositories: [repo.replace(/^.+[/]/, '')],
    permissions: {
      contents: 'write',
    },
  })
  if (resp.status !== 201) {
    throw new Error(json`Response status ${resp.status} (body: ${text})`)
  }
  const obj = JSON.parse(text) as {
    token: string,
    permissions: {
      contents: string,
    },
  }
  if (typeof obj?.token !== 'string') {
    throw new Error(json`Response missing token`)
  }
  if (obj?.permissions?.contents !== 'write') {
    throw new Error('Installation does not have contents:write access')
  }
  return obj.token as GitHubToken
}

/** Revoke a GitHub App installation token. */
export async function revokeInstallationToken(gh: GitHubApiUrl, token: GitHubToken): Promise<void> {
  const [resp, text] = await request(gh, token, 'DELETE', 'installation/token')
  if (resp.status !== 204) {
    throw new Error(json`Response status ${resp.status} (body: ${text})`)
  }
}

/** Make a GitHub REST API request. */
async function request(gh: GitHubApiUrl, token: GitHubToken, method: string, path: string, body?: any): Promise<[Response, string]> {
  const url = new URL(gh)
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/'
  }
  url.pathname += path

  const headers = new Headers({
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'User-Agent': userAgent,
    'X-GitHub-Api-Version': '2026-03-10',
  })
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(body)
  }

  try {
    const resp = await fetch(url, {
      method,
      headers,
      body,
    })
    const text = await resp.text()
    return [resp, text]
  } catch (err) {
    throw new Error(`${method} ${url}: ${err}`)
  }
}

export type GitObjectID = OID

export type Base64String = string & { __base64: true }

export interface CreateCommitOnBranchInput {
  branch: CommittableBranch
  expectedHeadOid: GitObjectID
  message: CommitMessage
  fileChanges: FileChanges
}

export interface CommittableBranch {
  repositoryNameWithOwner: string
  branchName: string
}

export interface CommitMessage {
  headline: string
  body: string
}

export interface FileChanges {
  additions: FileAddition[]
  deletions: FileDeletion[]
}

export interface FileAddition {
  contents: Base64String
  path: string
}

export interface FileDeletion {
  path: string
}

export function encodeBase64(buf: Buffer): Base64String {
  return buf.toString('base64') as Base64String
}

let lastGraphqlMutationRequest: number | undefined

/** Create a commit using the GitHub GraphQL API. */
export async function createCommitOnBranch(gh: GitHubGraphqlUrl, token: GitHubToken, input: CreateCommitOnBranchInput): Promise<GitObjectID> {
  const url = new URL(gh)
  const method = 'POST'
  const headers = new Headers({
    'Accept': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
  })
  const body = JSON.stringify({
    query: `
      mutation($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) {
          commit {
            oid
          }
        }
      }
    `,
    variables: {
      input,
    },
  })

  let obj
  for (let tries = 1; ; tries++) {
    if (lastGraphqlMutationRequest) {
      const elapsed = Date.now() - lastGraphqlMutationRequest
      if (elapsed < 1000) {
        await new Promise(resolve => setTimeout(resolve, 1000 - elapsed))
      }
    }
    lastGraphqlMutationRequest = Date.now()

    let resp, text
    try {
      resp = await fetch(url, {
        method,
        headers,
        body,
      })
      text = await resp.text()
    } catch (err) {
      throw new Error(`${method} ${url}: ${err}`)
    }

    if (resp.status >= 400) {
      switch (resp.status) {
        case 400: case 401: case 403: case 404: case 410: case 422: case 451:
          throw new Error(json`Non-retryable response status ${resp.status} (try: ${tries}, body: ${text})`)
      }
      if (tries > 3) {
        throw new Error(json`Retryable response status ${resp.status}, but no retries left (try: ${tries}, body: ${text})`)
      }
      const retryAfter = (tries ** 2) * 1000
      await new Promise(resolve => setTimeout(resolve, retryAfter))
      continue
    }

    const mt = resp.headers.get('Content-Type') ?? ''
    if (!mt.startsWith('application/json')) {
      if (resp.status !== 200) {
        throw new Error(json`Response status ${resp.status} (body: ${text})`)
      }
      throw new Error(json`Incorrect response type ${mt}`)
    }

    obj = JSON.parse(text) as {
      errors?: {
        type: string,
        message: string,
      }[],
      data?: {
        createCommitOnBranch: {
          commit: {
            oid: GitObjectID,
          },
        },
      },
    }
    break
  }
  if (obj?.errors?.length) {
    for (const err of obj.errors) {
      if (err?.message?.includes('No commit exists with specified expectedHeadOid')) {
        throw new Error(`Remote branch head is behind local parent commit (error: ${err})`)
      }
      if (err?.message?.includes('Expected branch to point to')) {
        throw new Error(`Local parent commit is behind remote branch head (error: ${err})`)
      }
    }
    const msg = obj.errors.map(e => `\t${e.type}: ${e.message}`).join('\n')
    throw new Error(`GitHub GraphQL mutation failed:\n${msg}`)
  }
  if (!obj?.data?.createCommitOnBranch?.commit?.oid) {
    throw new Error(json`GitHub created the commit but didn't return the oid`)
  }
  return obj?.data?.createCommitOnBranch?.commit?.oid
}

function json(strings: TemplateStringsArray, ...values: any[]) {
  return strings.reduce((acc, str, i) => acc + str + (i < values.length ? JSON.stringify(values[i]) : ''), '');
}
