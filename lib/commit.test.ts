import { describe, it } from 'node:test'
import { deepStrictEqual, ok, rejects } from 'node:assert'
import { dummy, repoSuite } from './git_test.ts'
import * as git from './git.ts'
import * as commit from './commit.ts'

repoSuite('commit', fi => {
  fi.commit('refs/heads/target', 999_999_999, 'target\n', [], [{ path: '.keep', content: '' }])
  const c1 = fi.commit('refs/heads/main', 1_000_000_000, 'initial commit\n', [], [])
  const c2 = fi.commit('refs/heads/main', 1_000_000_001, 'regular file\n', [c1], [{ path: 'file.txt', content: 'content\n' }, { path: 'test.bin', content: '\x00\x01\x02' }])
  const c3 = fi.commit('refs/heads/main', 1_000_000_002, 'subdir\n', [c2], [{ path: 'subdir/file1.txt', content: 'test\n' }])
  const c4 = fi.commit('refs/heads/main', 1_000_000_003, 'executable file\n', [c3], [{ path: 'script.sh', content: '#!/bin/sh\n', exec: true }])
  fi.commit('refs/heads/main', 1_000_000_004, 'gitlink\n', [c4], [{ path: 'submodule', gitlink: dummy }])
  fi.commit('refs/heads/single', 1_000_000_005, 'orphan\n', [], [])
  fi.commit('refs/heads/merge', 1_000_000_006, 'merge\n', [c1, c2], [])
}, tr => {
  const c1 = tr.revParse(git.peeledRev('main~4', 'commit'))
  const c2 = tr.revParse(git.peeledRev('main~3', 'commit'))
  const c3 = tr.revParse(git.peeledRev('main~2', 'commit'))
  const c4 = tr.revParse(git.peeledRev('main~1', 'commit'))
  const c5 = tr.revParse(git.peeledRev('main', 'commit'))

  tr.writeFile('staged', 'foo')
  tr.writeFile('unstaged', 'bar')
  tr.mkdir('subdir')
  tr.writeFile('subdir/file', 'baz')
  tr.add('staged')
  tr.add('subdir/file')
  tr.rmCached('submodule')

  function rejectsNotPushable(fn: () => Promise<void>) {
    return rejects(fn, (e: unknown) => {
      ok(e instanceof commit.NotPushableError)
      return true
    })
  }

  function diffEntryFor(diff: git.GitDiffEntry[], path: string) {
    const entry = diff.find((d) => d.path === path)
    if (!entry) throw new Error(`Missing expected diff entry ${JSON.stringify(path)}`)
    return entry
  }

  describe('changes', () => {
    it('rejects updating executable file', async () => {
      const repo = await git.repo('git', tr.path)
      const diff = await repo.diffTrees(c1, c4)
      await rejectsNotPushable(async () => {
        await commit.changes(repo, [diffEntryFor(diff, 'script.sh')], c4)
      })
    })

    it('does not reject deleting executable file', async () => {
      const repo = await git.repo('git', tr.path)
      const diff = await repo.diffTrees(c4, c1)
      const { additions, deletions } = await commit.changes(repo, [diffEntryFor(diff, 'script.sh')], c4)
      deepStrictEqual(additions, [])
      deepStrictEqual(deletions, [
        { path: 'script.sh' },
      ])
    })

    it('rejects updating submodule', async () => {
      const repo = await git.repo('git', tr.path)
      const diff = await repo.diffTrees(c1, c5)
      await rejectsNotPushable(async () => {
        await commit.changes(repo, [diffEntryFor(diff, 'submodule')], c5)
      })
    })

    it('does not reject deleting submodule', async () => {
      const repo = await git.repo('git', tr.path)
      const diff = await repo.diffTrees(c5, c1)
      const { additions, deletions } = await commit.changes(repo, [diffEntryFor(diff, 'submodule')], c5)
      deepStrictEqual(additions, [])
      deepStrictEqual(deletions, [
        { path: 'submodule' },
      ])
    })

    it('handles file additions', async () => {
      const repo = await git.repo('git', tr.path)
      const diff = await repo.diffTrees(c1, c2)
      const { additions, deletions } = await commit.changes(repo, diff)
      deepStrictEqual(additions.toSorted((a, b) => a.path.localeCompare(b.path)), [
        { path: 'file.txt', contents: 'Y29udGVudAo=' },
        { path: 'test.bin', contents: 'AAEC' },
      ])
      deepStrictEqual(deletions, [])
    })

    it('handles file deletions', async () => {
      const repo = await git.repo('git', tr.path)
      const diff = await repo.diffTrees(c2, c1)
      const { additions, deletions } = await commit.changes(repo, diff)
      deepStrictEqual(additions, [])
      deepStrictEqual(deletions, [
        { path: 'file.txt' },
        { path: 'test.bin' },
      ])
    })

    it('handles subdirectories', async () => {
      const repo = await git.repo('git', tr.path)
      const diff = await repo.diffTrees(c2, c3)
      const { additions, deletions } = await commit.changes(repo, diff)
      deepStrictEqual(additions, [
        { path: 'subdir/file1.txt', contents: 'dGVzdAo=' },
      ])
      deepStrictEqual(deletions, [])
    })
  })

  describe('staged', () => {
    it('creates commit from staged changes', async () => {
      const repo = await git.repo('git', tr.path)
      deepStrictEqual(await commit.staged(repo, 'subject\nmore subject\n\nbody\nmore body\n\nanother body'), {
        input: {
          message: {
            headline: 'subject\nmore subject',
            body: 'body\nmore body\n\nanother body',
          },
          fileChanges: {
            additions: [
              { path: 'staged', contents: 'Zm9v' },
              { path: 'subdir/file', contents: 'YmF6' },
            ],
            deletions: [
              { path: 'submodule' },
            ],
          },
          expectedHeadOid: c5,
        },
        local: null,
      })
    })
  })

  describe('commits', () => {
    it('rejects root commit', async () => {
      const repo = await git.repo('git', tr.path)
      await rejectsNotPushable(async () => {
        for await (const c of commit.commits(repo, 'single')) {
          console.debug(c)
        }
      })
    })

    it('rejects merge commit', async () => {
      const repo = await git.repo('git', tr.path)
      await rejectsNotPushable(async () => {
        for await (const c of commit.commits(repo, 'merge')) {
          console.debug(c)
        }
      })
    })

    it('handles empty range', async () => {
      const repo = await git.repo('git', tr.path)
      deepStrictEqual(await Array.fromAsync(commit.commits(repo, 'main..main')), [])
    })

    it('returns the commit oids', async () => {
      const repo = await git.repo('git', tr.path)
      const locals = []
      for await (const c of commit.commits(repo, `${c1}..${c2}`)) {
        locals.push(c.local)
      }
      deepStrictEqual(locals, [c2])
    })
  })
})
