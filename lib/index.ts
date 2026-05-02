import { type Commit, staged as staged_, commits as commits_, createCommitOnBranchInput as createCommitOnBranchInput_ } from './core/commit.ts'
import { type CommitOID, repo as repo_ } from './core/git.ts'
import type { CreateCommitOnBranchInput, GitHubGraphqlUrl, GitHubToken } from './core/github.ts'
import { createCommitOnBranch as createCommitOnBranch_, withRetries as withMaxRetries, withUserAgent } from './core/github.ts'

// note: only stuff exported from this file is part of the stable api

export { NotPushableError } from './core/commit.ts'

export type { Commit, CommitFile } from './core/commit.ts'

/**
 * Create a commit from staged changes.
 * @param git Name or path of the git binary.
 * @param repo Path to the git repository (may be relative).
 * @param message Commit message.
 * @returns An object representing the commit, throwing a {@link NotPushableError} if it contains unsupported changes.
 */
export async function staged(git: string, repo: string, message: string): Promise<Commit> {
  const r = await repo_(git, repo)
  return await staged_(r, message)
}

/**
 * Create commits from one or more existing commits.
 * @param git Name or path of the git binary.
 * @param repo Path to the git repository (may be relative).
 * @param revision Commits (see man {@link https://git-scm.com/docs/gitrevisions|gitrevisions[7]}).
 * @returns An object representing each commit in the range in graph order, throwing a {@link NotPushableError} if it contains unsupported changes.
 */
export async function* commits(git: string, repo: string, revision: string): AsyncGenerator<Commit> {
  const r = await repo_(git, repo)
  yield* commits_(r, revision)
}

/**
 * Get the input for the createCommitOnBranch mutation to create a commit.
 * @param git Name or path of the git binary.
 * @param repo Path to the git repository (may be relative).
 * @param commit The commit to create.
 * @returns The createCommitOnBranch input, throwing a {@link NotPushableError} if it contains unsupported changes.
 */
export async function createCommitOnBranchInput(git: string, repo: string, commit: Commit): Promise<Omit<CreateCommitOnBranchInput, 'branch'>> {
  const r = await repo_(git, repo)
  return await createCommitOnBranchInput_(r, commit)
}

export interface CreateCommitOnBranchOptions {
  /** The maximum number of retries (0 for none). */
  maxRetries?: number,
  /** Set the user agent. */
  userAgent?: string,
}

/**
 * Invokes the createCommitOnBranch mutation, automatically handling retries and
 * throttling.
 * @param url GitHub GraphQL API URL.
 * @param token GitHub token with contents:write permissions.
 * @param input Input for the createCommitOnBranch mutation.
 */
export async function createCommitOnBranch(url: string, token: string, input: CreateCommitOnBranchInput, options?: CreateCommitOnBranchOptions): Promise<CommitOID> {
  let tok = String(token) as GitHubToken
  if (options?.maxRetries != undefined) {
    tok = withMaxRetries(tok, options?.maxRetries)
  }
  if (options?.userAgent != undefined) {
    tok = withUserAgent(tok, options?.userAgent)
  }
  return await createCommitOnBranch_(url as GitHubGraphqlUrl, tok, input) as CommitOID
}
