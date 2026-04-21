import {
  type BlobOID, type CommitOID, type GitDiffEntry, type OID, type Repo, type TreeOID,
  diffStatus, isKnownMode as isKnownTreeMode, prettyTreeMode, splitCommitMessage,
  treeMode,
} from "./git.ts"
import {
  type CreateCommitOnBranchInput,
  type CreateBlobInput, type CreateCommitInput, type CreateTreeInput,
  encodeBase64,
} from "./github.ts"
import { debuglog, jsonify } from '../util/util.ts'

const debug = debuglog('commit') // NODE_DEBUG=commit

export class NotPushableError extends Error {
  public commit: CommitOID | undefined
  public path: string | undefined

  constructor(commit: CommitOID | undefined, message: string, path?: string | undefined) {
    super(`${commit ? `Commit ${commit}` : `Staging area`} is not pushable: ${message}${path ? ` ${path}` : ''}`)
    this.name = 'NotPushableError'
    this.commit = commit
    this.path = path
  }
}

/** A pending commit. The committer/author/date is not included. */
export interface Commit {
  /** The local commit hash, or undefined if from staged changes. */
  oid?: CommitOID,
  /** Parents of the commit. Empty for the initial commit of a branch. */
  parents: CommitOID[],
  /** Raw commit message. */
  message: string,
  /** All modified files in the commit. */
  changes: CommitFile[],
}

/** A file in a pending commit. */
export interface CommitFile {
  /** The path of the tree entry. */
  path: string,
  /** The mode of the tree entry. Will not be 040000 (subtrees are flattened). Zero if deleted. */
  mode: Exclude<keyof typeof treeMode, 0o040000> | 0,
  /** The oid of the target object (undefined, blob, or commit based on the mode). */
  oid?: OID,
}

export async function staged(repo: Repo, message: string): Promise<Commit> {
  const parent = await repo.head()
  const diff = await repo.diffStaged(parent)
  debug(`staged: ${parent} +/- ${diff.length}`)
  return {
    parents: [parent],
    message,
    changes: await changes(repo, diff),
  }
}

export async function* commits(repo: Repo, revision: string): AsyncGenerator<Commit & { oid: CommitOID }> {
  for (const [commit, parents] of await repo.commits(revision)) {
    const parent = parents.length ? parents[0] : await repo.emptyTree()
    const message = await repo.message(commit)
    const diff = await repo.diffTrees(parent, commit)
    debug(`commit: ${commit.slice(0, 12)}^{${parents.map(x => x.slice(0, 12)).join(',')}} +/- ${diff.length}`)
    yield {
      oid: commit,
      parents,
      message,
      changes: await changes(repo, diff),
    }
  }
}

// keep changes async just in case we need to get more info from the repo in the future
export async function changes(repo: Repo, diff: GitDiffEntry[], commit?: CommitOID | undefined): Promise<CommitFile[]> {
  const files = []
  for (const file of diff) {
    debug([
      `diff:`,
      `${repo.gitDir.replace(/\/\.git$/, '')}@${commit?.slice(0, 10) || 'staged'}`,
      `{${file.src_oid.slice(0, 12)}:${prettyTreeMode(file.src_mode)}`,
      `->`,
      `${file.dst_oid.slice(0, 12)}:${prettyTreeMode(file.dst_mode)}`,
      `${Object.entries(diffStatus).find(x => x[1] == file.status)?.[0] ?? file.status}`,
      `${JSON.stringify(file.path)}`,
    ].join(' '))
    switch (file.status) {
      case diffStatus.added:
      case diffStatus.modified:
      case diffStatus.typeChanged:
        if (!isKnownTreeMode(file.dst_mode)) {
          throw new NotPushableError(commit, `contains a unknown (mode ${file.dst_mode}) file`, file.path)
        }
        if (file.dst_mode === 0o040000) {
          throw new TypeError(`Diff must be recursive (got a subtree)`)
        }
        files.push({
          path: file.path,
          mode: file.dst_mode,
          oid: file.dst_oid,
        })
        break
      case diffStatus.deleted:
        files.push({
          path: file.path,
          mode: 0 as const,
        })
        break
      default:
        throw new NotPushableError(commit, `unsupported diff status ${file.status} for entry`, file.path)
    }
  }
  return files
}

/**
 * Convert the commit into input for the POST /repos/{owner}/{repo}/git/blobs
 * endpoint, throwing a {@link NotPushableError} if it contains something not
 * supported.
 */
export async function* createBlobInput(repo: Repo, commit: Commit): AsyncGenerator<CreateBlobInput> {
  throw new Error('TODO')
}

/**
 * Convert the commit into input for the POST /repos/{owner}/{repo}/git/trees
 * endpoint, throwing a {@link NotPushableError} if it contains something not
 * supported.
 */
export async function createTreeInput(commit: Commit, blobs: readonly BlobOID[], baseTree?: TreeOID): Promise<CreateTreeInput> {
  throw new Error('TODO')
}

/**
 * Convert the commit into input for the POST /repos/{owner}/{repo}/git/commits
 * endpoint, throwing a {@link NotPushableError} if it contains something not
 * supported.
 */
export async function createCommitInput(commit: Commit, tree: TreeOID): Promise<CreateCommitInput> {
  return {
    message: commit.message,
    parents: commit.parents,
    tree,
  }
}

/**
 * Convert the commit into input for the createCommitOnBranch mutation,
 * splitting the commit message, loading all blobs into memory, and throwing a
 * {@link NotPushableError} if it contains something not supported.
 */
export async function createCommitOnBranchInput(repo: Repo, commit: Commit): Promise<Omit<CreateCommitOnBranchInput, 'branch'>> {
  if (commit.parents.length < 1) {
    throw new NotPushableError(commit.oid, `has no parents (creating a new branch is not supported)`)
  }
  if (commit.parents.length > 1) {
    throw new NotPushableError(commit.oid, `has multiple parents (merge commits are not supported)`)
  }
  const parent = commit.parents[0]

  const { subject, body } = splitCommitMessage(commit.message)
  debug(jsonify`msg: subject=${subject} body=${body}`)

  const additions = [], deletions = []
  for (const entry of commit.changes) {
    if (entry.mode) {
      assertCreateCommitOnBranchAddition(commit.oid, entry)
      additions.push({
        path: entry.path,
        contents: encodeBase64(await repo.catFile(entry.oid)),
      })
    } else {
      deletions.push({
        path: entry.path,
      })
    }
  }

  return {
    message: {
      headline: subject,
      body: body,
    },
    fileChanges: {
      additions,
      deletions,
    },
    expectedHeadOid: parent,
  }
}

function assertCreateCommitOnBranchAddition(commit: CommitOID | undefined, file: CommitFile): asserts file is CommitFile & { oid: BlobOID } {
  if (!file.mode || !file.oid) {
    throw new TypeError(`Not a file addition`)
  }
  // git@v2.53.0/fsck.c:722-743
  switch (file.mode) {
    case 0o100644: // regular file
    case 0o100664: // regular file (legacy)
      break // okay
    case 0o100755: // executable file
      throw new NotPushableError(commit, `contains an executable file`, file.path)
    case 0o120000: // symlink
      throw new NotPushableError(commit, `contains a symbolic link`, file.path)
    case 0o160000: // gitlink (submodule)
      throw new NotPushableError(commit, `contains a submodule`, file.path)
    /* node:coverage ignore next 2 */ // all known git objects covered
    default:
      throw new NotPushableError(commit, `contains a non-regular (mode ${file.mode}) file`, file.path)
  }
}
