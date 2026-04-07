import * as git from './git.ts'

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

async function changes(gitBinary: string, diff: git.GitDiffEntry[], commit?: git.CommitOID | undefined) {
  const additions = []
  const deletions = []
  for (const file of diff) {
    switch (file.status) {
      case git.diffStatus.added:
      case git.diffStatus.modified:
      case git.diffStatus.typeChanged:
        const objs = commit
          ? await git.listTree(gitBinary, commit, file.path)
          : await git.listIndex(gitBinary, file.path)
        if (objs.length !== 1 || objs[0].type == 'tree') {
          // diff-tree / diff-files doesn't return trees when -r, so it should only ever have one
          throw new git.GitParseError(`Get tree object ${file.path}: expected exactly one non-tree object, got ${JSON.stringify(objs)}`)
        }
        const obj = objs[0]
        switch (obj.type) {
          case 'blob':
            break // okay
          case 'commit':
            throw new NotPushableError(commit, `contains an added/modified submodule`, file.path)
          default:
            throw new NotPushableError(commit, `contains an added/modified unrecognized object of type ${obj.type} named`, file.path)
        }
        switch (obj.mode) {
          case 100644: // regular file
            break // okay
          case 100755: // executable file
            throw new NotPushableError(commit, `contains an executable file`, file.path)
          case 120000: // symbolic link
            throw new NotPushableError(commit, `contains a symbolic link`, file.path)
          default:
            throw new NotPushableError(commit, `contains a non-regular (mode ${obj.mode}) file`, file.path)
        }
        const buf = await git.catFile(gitBinary, obj.name)
        additions.push({
          path: obj.path,
          contents: buf.toString('base64')
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
