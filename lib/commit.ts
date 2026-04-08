import * as git from './git.ts'
import * as github from './github.ts'

export class NotPushableError extends Error {
  public commit: git.CommitOID | undefined
  public path: string | undefined

  constructor(commit: git.CommitOID | undefined, message: string, path?: string | undefined) {
    super(`${commit ? `Commit ${commit}` : `Staging area`} is not pushable: ${message}${path ? ` ${path}` : ''}`)
    this.name = 'NotPushableError'
    this.commit = commit
    this.path = path
  }
}

export async function changes(repo: git.Repo, diff: git.GitDiffEntry[], commit?: git.CommitOID | undefined): Promise<github.FileChanges> {
  const additions = []
  const deletions = []
  for (const file of diff) {
    switch (file.status) {
      case git.diffStatus.added:
      case git.diffStatus.modified:
      case git.diffStatus.typeChanged:
        const objs = commit
          ? await repo.listTree(commit, file.path)
          : await repo.listIndex(file.path)
        if (objs.length !== 1) {
          // diff-tree / diff-files doesn't return trees when -r, so it should only ever have one
          throw new git.GitParseError(`Get tree object ${file.path}: expected exactly one non-tree object, got ${JSON.stringify(objs)}`)
        }
        const obj = objs[0]
        // git@v2.53.0/fsck.c:722-743
        switch (obj.mode) {
          case 0o040000: // tree (directory)
            throw new Error(`WTF: Why did a recursive ls-tree/ls-files return a directory`)
          case 0o100644: // regular file
          case 0o100664: // regular file (legacy)
            break // okay
          case 0o100755: // executable file
            throw new NotPushableError(commit, `contains an executable file`, file.path)
          case 0o120000: // symlink
            throw new NotPushableError(commit, `contains a symbolic link`, file.path)
          case 0o160000: // gitlink (submodule)
            throw new NotPushableError(commit, `contains a submodule`, file.path)
          default:
            throw new NotPushableError(commit, `contains a non-regular (mode ${obj.mode}) file`, file.path)
        }
        switch (obj.type) {
          case 'blob':
            break // okay
          case 'commit':
            throw new NotPushableError(commit, `contains an added/modified submodule`, file.path)
          default:
            throw new NotPushableError(commit, `contains an added/modified unrecognized object of type ${obj.type} named`, file.path)
        }
        const buf = await repo.catFile(obj.name)
        additions.push({
          path: obj.path,
          contents: github.encodeBase64(buf),
        })
        break

      case git.diffStatus.deleted:
        deletions.push({
          path: file.path,
        })
        break

      default:
        throw new NotPushableError(commit, `unsupported diff status ${file.status} for entry`, file.path)
    }
  }
  return {additions, deletions}
}
