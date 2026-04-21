import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert'
import { describe, it } from 'node:test'
import { dummy, repoSuite } from '../lib/util/gittest.ts'
import { type GitDiffEntry, peeledRev, repo as gitRepo, type Repo, type CommitOID } from '../lib/core/git.ts'
import * as commit from '../lib/core/commit.ts'

repoSuite('commit', fi => {
  fi.commit('refs/heads/target', 999_999_999, 'target\n', [], [{ path: '.keep', content: '' }])
  const c1 = fi.commit('refs/heads/main', 1_000_000_000, 'initial commit\n', [], [])
  const c2 = fi.commit('refs/heads/main', 1_000_000_001, 'regular file\n', [c1], [{ path: 'file.txt', content: 'content\n' }, { path: 'test.bin', content: '\x00\x01\x02' }])
  const c3 = fi.commit('refs/heads/main', 1_000_000_002, 'subdir\n', [c2], [{ path: 'subdir/file1.txt', content: 'test\n' }])
  const c4 = fi.commit('refs/heads/main', 1_000_000_003, 'executable file\n', [c3], [{ path: 'script.sh', content: '#!/bin/sh\n', exec: true }])
  fi.commit('refs/heads/main', 1_000_000_004, 'gitlink\n', [c4], [{ path: 'submodule', gitlink: dummy }])
  fi.commit('refs/heads/single', 1_000_000_005, 'orphan\n', [], [])
  fi.commit('refs/heads/merge', 1_000_000_006, 'merge\n', [c1, c2], [])
  const e1 = fi.commit('refs/heads/everything', 1_000_000_000, 'initial commit\n', [], [])
  const e2 = fi.commit('refs/heads/everything', 1_000_000_003, 'test commit\n\ntest', [e1], [{ path: 'file.txt', content: 'content\n' }, { path: 'file1.txt', content: 'content\n' }])
  const e3 = fi.commit('refs/heads/everything', 1_000_000_002, '\nanother commit\n\n', [e2], [{ path: 'file.txt' }, { path: 'file1.txt', content: 'content update\n' }])
  fi.commit('refs/heads/everything', 1_000_000_003, 'test commit\n\ntest', [e3], [{ path: 'file.txt', content: 'content update\n' }, { path: 'file3.txt', content: 'test\n' }])
  const sym1 = fi.commit('refs/heads/symlink', 1_000_000_010, 'add symlink\n', [c1], [{ path: 'link.txt', symlink: 'target.txt' }])
  fi.commit('refs/heads/symlink', 1_000_000_011, 'delete symlink\n', [sym1], [{ path: 'link.txt' }])
}, tr => {
  const c1 = tr.revParse(peeledRev('main~4', 'commit'))
  const c2 = tr.revParse(peeledRev('main~3', 'commit'))
  const c3 = tr.revParse(peeledRev('main~2', 'commit'))
  const c4 = tr.revParse(peeledRev('main~1', 'commit'))
  const c5 = tr.revParse(peeledRev('main', 'commit'))
  const e1 = tr.revParse(peeledRev('everything~3', 'commit'))
  const e2 = tr.revParse(peeledRev('everything~2', 'commit'))
  const e3 = tr.revParse(peeledRev('everything~1', 'commit'))
  const e4 = tr.revParse(peeledRev('everything', 'commit'))
  const s1 = tr.revParse(peeledRev('symlink~1', 'commit'))
  const s2 = tr.revParse(peeledRev('symlink', 'commit'))

  tr.writeFile('staged', 'foo')
  tr.writeFile('unstaged', 'bar')
  tr.mkdir('subdir')
  tr.writeFile('subdir/file', 'baz')
  tr.add('staged')
  tr.add('subdir/file')
  tr.rmCached('submodule')

  function rejectsNotPushable(fn: () => Promise<void>) {
    return rejects(fn, (e: unknown) => {
      ok(e instanceof commit.NotPushableError, `${e}`)
      return true
    })
  }

  function diffEntryFor(diff: GitDiffEntry[], path: string) {
    const entry = diff.find((d) => d.path === path)
    if (!entry) throw new Error(`Missing expected diff entry ${JSON.stringify(path)}`)
    return entry
  }

  describe('createCommitOnBranchInput', () => {
    async function fileChangesFor(repo: Repo, diff: GitDiffEntry[], path?: string) {
      const input = await commit.createCommitOnBranchInput(repo, {
        message: 'fake\n\nbody',
        changes: await commit.changes(repo, path ? [diffEntryFor(diff, path)] : diff),
        parent: 'dummy' as CommitOID,
      })
      strictEqual(input.expectedHeadOid, 'dummy')
      strictEqual(input.message.headline, 'fake')
      strictEqual(input.message.body, 'body')
      return input.fileChanges
    }

    it('rejects updating executable file', async () => {
      const repo = await gitRepo('git', tr.path)
      const diff = await repo.diffTrees(c1, c4)
      await rejectsNotPushable(async () => {
        await fileChangesFor(repo, diff, 'script.sh')
      })
    })

    it('does not reject deleting executable file', async () => {
      const repo = await gitRepo('git', tr.path)
      const diff = await repo.diffTrees(c4, c1)
      const { additions, deletions } = await fileChangesFor(repo, diff, 'script.sh')
      deepStrictEqual(additions, [])
      deepStrictEqual(deletions, [
        { path: 'script.sh' },
      ])
    })

    it('rejects updating submodule', async () => {
      const repo = await gitRepo('git', tr.path)
      const diff = await repo.diffTrees(c1, c5)
      await rejectsNotPushable(async () => {
        await fileChangesFor(repo, diff, 'submodule')
      })
    })

    it('does not reject deleting submodule', async () => {
      const repo = await gitRepo('git', tr.path)
      const diff = await repo.diffTrees(c5, c1)
      const { additions, deletions } = await fileChangesFor(repo, diff, 'submodule')
      deepStrictEqual(additions, [])
      deepStrictEqual(deletions, [
        { path: 'submodule' },
      ])
    })

    it('rejects updating symlink', async () => {
      const repo = await gitRepo('git', tr.path)
      const diff = await repo.diffTrees(c1, s1)
      await rejectsNotPushable(async () => {
        await fileChangesFor(repo, diff, 'link.txt')
      })
    })

    it('does not reject deleting symlink', async () => {
      const repo = await gitRepo('git', tr.path)
      const diff = await repo.diffTrees(s1, s2)
      const { additions, deletions } = await fileChangesFor(repo, diff, 'link.txt')
      deepStrictEqual(additions, [])
      deepStrictEqual(deletions, [
        { path: 'link.txt' },
      ])
    })

    it('handles file additions', async () => {
      const repo = await gitRepo('git', tr.path)
      const diff = await repo.diffTrees(c1, c2)
      const { additions, deletions } = await fileChangesFor(repo, diff)
      deepStrictEqual(additions.toSorted((a, b) => a.path.localeCompare(b.path)), [
        { path: 'file.txt', contents: 'Y29udGVudAo=' },
        { path: 'test.bin', contents: 'AAEC' },
      ])
      deepStrictEqual(deletions, [])
    })

    it('handles file deletions', async () => {
      const repo = await gitRepo('git', tr.path)
      const diff = await repo.diffTrees(c2, c1)
      const { additions, deletions } = await fileChangesFor(repo, diff)
      deepStrictEqual(additions, [])
      deepStrictEqual(deletions, [
        { path: 'file.txt' },
        { path: 'test.bin' },
      ])
    })

    it('handles subdirectories', async () => {
      const repo = await gitRepo('git', tr.path)
      const diff = await repo.diffTrees(c2, c3)
      const { additions, deletions } = await fileChangesFor(repo, diff)
      deepStrictEqual(additions, [
        { path: 'subdir/file1.txt', contents: 'dGVzdAo=' },
      ])
      deepStrictEqual(deletions, [])
    })

    it('rejects root commit', async () => {
      const repo = await gitRepo('git', tr.path)
      await rejectsNotPushable(async () => {
        for await (const c of commit.commits(repo, 'single')) {
          console.debug(await commit.createCommitOnBranchInput(repo, c))
        }
      })
    })

    it('rejects merge commit', async () => {
      const repo = await gitRepo('git', tr.path)
      await rejectsNotPushable(async () => {
        for await (const c of commit.commits(repo, 'merge')) {
          console.debug(await commit.createCommitOnBranchInput(repo, c))
        }
      })
    })
  })

  describe('staged', () => {
    it('creates commit from staged changes', async () => {
      const repo = await gitRepo('git', tr.path)
      deepStrictEqual(await commit.staged(repo, 'subject\nmore subject\n\nbody\nmore body\n\nanother body'), {
        parent: c5,
        message: 'subject\nmore subject\n\nbody\nmore body\n\nanother body',
        changes: [
          { mode: 33188, oid: '19102815663d23f8b75a47e7a01965dcdc96468c', path: 'staged' },
          { mode: 33188, oid: '3f9538666251333f5fa519e01eb267d371ca9c78', path: 'subdir/file' },
          { mode: 0, path: 'submodule' },
        ],
      })
    })
  })

  describe('commits', () => {
    it('handles empty range', async () => {
      const repo = await gitRepo('git', tr.path)
      deepStrictEqual(await Array.fromAsync(commit.commits(repo, 'main..main')), [])
    })

    it('returns the commit oids', async () => {
      const repo = await gitRepo('git', tr.path)
      const locals = []
      for await (const c of commit.commits(repo, `${c1}..${c2}`)) {
        locals.push(c.oid)
      }
      deepStrictEqual(locals, [c2])
    })

    it('creates commit from the root commit', async () => {
      const repo = await gitRepo('git', tr.path)
      deepStrictEqual(await Array.fromAsync(commit.commits(repo, e1)), [{
        oid: e1,
        message: 'initial commit\n',
        changes: [],
      }])
    })

    it('rejects merge commit', async () => {
      const repo = await gitRepo('git', tr.path)
      await rejectsNotPushable(async () => {
        for await (const c of commit.commits(repo, 'merge')) {
          console.debug(c)
        }
      })
    })

    it('creates commits from existing commits', async () => {
      const repo = await gitRepo('git', tr.path)
      const commits = await Array.fromAsync(commit.commits(repo, `${e1}..${e4}`))
      deepStrictEqual(commits, [
        {
          oid: e2,
          parent: e1,
          message: 'test commit\n\ntest',
          changes: [
            { mode: 33188, oid: 'd95f3ad14dee633a758d2e331151e950dd13e4ed', path: 'file.txt' },
            { mode: 33188, oid: 'd95f3ad14dee633a758d2e331151e950dd13e4ed', path: 'file1.txt' },
          ],
        },
        {
          oid: e3,
          parent: e2,
          message: '\nanother commit\n\n',
          changes: [
            { mode: 0, path: 'file.txt' },
            { mode: 33188, oid: '6c629dadd05e98aef7f0dc87d2cb926be807f836', path: 'file1.txt' },
          ],
        },
        {
          oid: e4,
          parent: e3,
          message: 'test commit\n\ntest',
          changes: [
            { mode: 33188, oid: '6c629dadd05e98aef7f0dc87d2cb926be807f836', path: 'file.txt' },
            { mode: 33188, oid: '9daeafb9864cf43055ae93beb0afd6c7d144bfa4', path: 'file3.txt' },
          ],
        }
      ])
    })
  })
})
