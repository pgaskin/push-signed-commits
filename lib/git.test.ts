import { suite, describe, it } from 'node:test'
import { equal, deepStrictEqual, ok, rejects, throws, strictEqual } from 'node:assert'
import { realpathSync } from 'node:fs'
import { join, normalize, isAbsolute } from 'node:path'
import { repoSuite, dummy } from './git_test.ts'
import * as git from './git.ts'

suite('git', () => {
  describe('splitCommitMessage', () => {
    const test = (tc: {
      what: string,
      message: string,
      subject: string,
      body: string,
    }) => {
      it(tc.what, () => {
        const { subject, body } = git.splitCommitMessage(tc.message)
        equal(subject, tc.subject, 'subject')
        equal(body, tc.body, 'body')
      })
    }
    test({
      what: 'empty',
      message: '',
      subject: '',
      body: '',
    })
    test({
      what: 'subject only',
      message: 'subject',
      subject: 'subject',
      body: '',
    })
    test({
      what: 'subject and body',
      message: 'subject\n\nbody',
      subject: 'subject',
      body: 'body',
    })
    test({
      what: 'two-line subject and body',
      message: 'subject\nsubject2\n\nbody\nbody2',
      subject: 'subject\nsubject2',
      body: 'body\nbody2',
    })
    test({
      what: 'three-line subject and body',
      message: 'subject\nsubject2\nsubject3\n\nbody\nbody2\nbody3',
      subject: 'subject\nsubject2\nsubject3',
      body: 'body\nbody2\nbody3',
    })
    test({
      what: 'three-line subject and body with insignificant newlines',
      message: '\n\nsubject\nsubject2\nsubject3\n\n\n\nbody\nbody2\nbody3\n\n',
      subject: 'subject\nsubject2\nsubject3',
      body: 'body\nbody2\nbody3',
    })
    test({
      what: 'three-line subject and body with insignificant newlines and whitespace',
      message: '  \t \n   \nsubject\nsubject2\nsubject3\n \f  \n  \v \n\nbody\nbody2\nbody3\n \r  \n',
      subject: 'subject\nsubject2\nsubject3',
      body: 'body\nbody2\nbody3',
    })
    test({
      what: 'three-line subject and body with insignificant newlines and whitespace, and significant whitespace',
      message: '  \t \n   \nsubject\n   subject2\nsubject3\n \f  \n  \v \n\nbody\n  body2\nbody3\n \r  \n',
      subject: 'subject\n   subject2\nsubject3',
      body: 'body\n  body2\nbody3',
    })
  })
  describe('trimBlankLinesStart', () => {
    const test = (tc: [
      string, // what
      string, // in
      string, // out
    ]) => {
      it(tc[0], () => {
        const out = git.__test.trimBlankLinesStart(tc[1])
        equal(out, tc[2])
      })
      test(['empty', '', ''])
      test(['one newline', '\n', ''])
      test(['all newline', '\n\n\n', ''])
      test(['no newline', 'test', 'test'])
      test(['no newline all spaces', '   ', '   '])
      test(['no blank lines', 'test\ntest', 'test\ntest'])
      test(['leading and trailing newline', '\ntest\ntest\n', 'test\ntest\n'])
      test(['leading and trailing newlines', '\n\ntest\ntest\n\n', 'test\ntest\n\n'])
      test(['ascii whitespace', '\n \t\r\v \ntest\n \t\r\v \n', 'test\n \t\r\v \n'])
      test(['blank lines in middle', 'test\n\n\ntest', 'test\n\n\ntest'])
      test(['blank line at start', '\ntest\n', 'test\n'])
      test(['blank line in middle', 'test\n\ntest\n', 'test\n\ntest\n'])
      test(['blank line at end', 'test\n\n', 'test\n\n'])
      test(['blank line with ascii whitespace', 'test\n \t\r\v \ntest', 'test\n \t\r\v \ntest'])
    }
  })
  describe('trimBlankLinesEnd', () => {
    const test = (tc: [
      string, // what
      string, // in
      string, // out
    ]) => {
      it(tc[0], () => {
        const out = git.__test.trimBlankLinesEnd(tc[1])
        equal(out, tc[2])
      })
    }
    test(['empty', '', ''])
    test(['one newline', '\n', ''])
    test(['all newline', '\n\n\n', ''])
    test(['no newline', 'test', 'test'])
    test(['no newline all spaces', '   ', '   '])
    test(['no blank lines', 'test\ntest', 'test\ntest'])
    test(['leading and trailing newline', '\ntest\ntest\n', '\ntest\ntest'])
    test(['leading and trailing newlines', '\n\ntest\ntest\n\n', '\n\ntest\ntest'])
    test(['ascii whitespace', '\n \t\r\v \ntest\n \t\r\v \n', '\n \t\r\v \ntest'])
    test(['blank lines in middle', 'test\n\n\ntest', 'test\n\n\ntest'])
    test(['blank line at start', '\ntest\n', '\ntest'])
    test(['blank line in middle', 'test\n\ntest\n', 'test\n\ntest'])
    test(['blank line at end', 'test\n\n', 'test'])
    test(['blank line with ascii whitespace', 'test\n \t\r\v \ntest', 'test\n \t\r\v \ntest'])
  })
  describe('cutBlankLine', () => {
    const test = (tc: [
      string, // what
      string, // in
      string, // before
      string, // after
    ]) => {
      it(tc[0], () => {
        const [before, after] = git.__test.cutBlankLine(tc[1])
        equal(before, tc[2], 'before')
        equal(after, tc[3], 'after')
      })
    }
    test(['empty', '', '', ''])
    test(['one newline', '\n', '', ''])
    test(['all newline', '\n\n\n', '', '\n\n'])
    test(['no newline', 'test', 'test', ''])
    test(['no newline all spaces', '   ', '   ', ''])
    test(['no blank lines', 'test\ntest', 'test\ntest', ''])
    test(['leading and trailing newline', '\ntest\ntest\n', '', 'test\ntest\n'])
    test(['leading and trailing newlines', '\n\ntest\ntest\n\n', '', '\ntest\ntest\n\n'])
    test(['ascii whitespace', '\n \t\r\v \ntest\n \t\r\v \n', '', ' \t\r\v \ntest\n \t\r\v \n'])
    test(['blank lines in middle', 'test\n\n\ntest', 'test\n', '\ntest'])
    test(['blank line at start', '\ntest\n', '', 'test\n'])
    test(['blank line in middle', 'test\n\ntest\n', 'test\n', 'test\n'])
    test(['blank line at end', 'test\n\n', 'test\n', ''])
    test(['blank line with ascii whitespace', 'test\n \t\r\v \ntest', 'test\n', 'test'])
  })
  describe('unquote', () => {
    const test = (what: string, input: string, expected: string) => {
      it(what, () => equal(git.__test.unquote(input), expected))
    }
    test('plain path', '"foo.txt"', 'foo.txt')
    test('double quote in name', '"\\"quoted\\".txt"', '"quoted".txt')
    test('backslash in name', '"back\\\\slash.txt"', 'back\\slash.txt')
    test('backslash escape sequences', '"\\a\\b\\f\\n\\r\\t\\v"', '\x07\b\f\n\r\t\v')
    test('octal escape', '"\\303\\251"', '\u00e9')
    it('throws if not quoted', () => {
      throws(() => git.__test.unquote('foo'), /GitParseError/)
    })
  })
})

repoSuite('git (repo)', fi => {
  /*
  * main:       C1 (README.md) -> C2 (+foo.txt)
  * feature:    C1 -> C3 (+bar.txt)
  * merge:      merge of C2+C3
  * misc:       C1 -> (+script.sh exec, +subdir/deep.txt, +sub gitlink->TARGET)
  * utf16:      C2 -> iso-8859-1 encoded message
  * special:    C1 -> (+files with quotes and backslashes in names)
  * outoforder: four commits not in date order
  */
  const c1 = fi.commit('refs/heads/main', 1_000_000_000, 'initial\n', [], [{ path: 'README.md', content: 'hello\n' }])
  const c2 = fi.commit('refs/heads/main', 1_000_000_001, 'second\n', [c1], [{ path: 'foo.txt', content: 'foo\n' }])
  const c3 = fi.commit('refs/heads/feature', 1_000_000_002, 'feature\n', [c1], [{ path: 'bar.txt', content: 'bar\n' }])
  fi.commit('refs/heads/merge', 1_000_000_003, 'merge\n', [c2, c3], [])
  fi.commit('refs/heads/misc', 1_000_000_004, 'misc\n', [c1], [
    { path: 'script.sh', content: '#!/bin/sh\n', exec: true },
    { path: 'subdir/deep.txt', content: 'deep\n' },
    { path: 'sub', gitlink: dummy },
  ])
  fi.commit('refs/heads/symlink', 1_000_000_007, 'symlink\n', [c1], [
    { path: 'link.txt', symlink: 'target.txt' },
    { path: 'deep/link', symlink: '../file.txt' },
  ])
  fi.commit('refs/heads/utf16', 1_000_000_005, Buffer.from('caf\xe9\n', 'latin1'), [c2], [], 'ISO-8859-1')
  // outoforder: commits with timestamps that don't match topological order
  // ood-first (parent) has a higher timestamp than ood-second (child)
  const o1 = fi.commit('refs/heads/outoforder', 1_000_000_010, 'first\n', [], [])
  const o2 = fi.commit('refs/heads/outoforder', 999_999_998, 'second\n', [o1], [])
  const o3 = fi.commit('refs/heads/outoforder', 1_000_000_030, 'third\n', [o2], [])
  fi.commit('refs/heads/outoforder', 999_999_985, 'fourth\n', [o3], [])
  if (process.platform !== 'win32') fi.commit('refs/heads/special', 1_000_000_006, 'special\n', [c1], [
    { path: '"quoted".txt', content: 'quoted\n' },
    { path: 'back\\slash.txt', content: 'backslash\n' },
  ])
}, tr => {
  const c1 = tr.revParse(git.peeledRev('refs/heads/main~1', 'commit'))
  const c2 = tr.revParse(git.peeledRev('refs/heads/main', 'commit'))
  const c3 = tr.revParse(git.peeledRev('refs/heads/feature', 'commit'))
  const c4 = tr.revParse(git.peeledRev('refs/heads/merge', 'commit'))
  const c5 = tr.revParse(git.peeledRev('refs/heads/utf16', 'commit'))
  const o1 = tr.revParse(git.peeledRev('refs/heads/outoforder~3', 'commit'))
  const o2 = tr.revParse(git.peeledRev('refs/heads/outoforder~2', 'commit'))
  const o3 = tr.revParse(git.peeledRev('refs/heads/outoforder~1', 'commit'))
  const o4 = tr.revParse(git.peeledRev('refs/heads/outoforder', 'commit'))
  const m1 = tr.revParse(git.peeledRev('refs/heads/misc', 'commit'))
  const s1 = tr.revParse(git.peeledRev('refs/heads/symlink', 'commit'))
  const sp = process.platform !== 'win32' ? tr.revParse(git.peeledRev('refs/heads/special', 'commit')) : undefined

  tr.mkdir('emptydir')

  describe('version', () => {
    it('returns a non-empty version string', async () => {
      ok(/\S/.test(await git.version('git')))
    })
    it('checkVersion is compatible', async () => {
      const { version, compatible } = await git.checkVersion('git')
      ok(compatible, version)
    })
  })

  describe('head', () => {
    it('returns tip of main', async () => {
      strictEqual(await git.head('git', tr.path), c2)
    })
  })

  describe('commits', () => {
    it('single rev resolves to tip', async () => {
      deepStrictEqual(await git.commits('git', tr.path, 'refs/heads/main'), [c2])
    })
    it('empty range', async () => {
      deepStrictEqual(await git.commits('git', tr.path, `${c2}..${c2}`), [])
    })
    it('range', async () => {
      deepStrictEqual(await git.commits('git', tr.path, `${c1}..${c2}`), [c2])
    })
    it('ordered from parent to child', async () => {
      deepStrictEqual(await git.commits('git', tr.path, `${c1}..${c5}`), [c2, c5])
    })
    it('is in topological order', async () => {
      deepStrictEqual(await git.commits('git', tr.path, `${c1}..refs/heads/outoforder`), [o1, o2, o3, o4])
    })
  })

  describe('parents', () => {
    it('root commit has none', async () => {
      deepStrictEqual(await git.parents('git', tr.path, c1), [])
    })
    it('second commit has one parent', async () => {
      deepStrictEqual(await git.parents('git', tr.path, c2), [c1])
    })
    it('merge commit has two parents', async () => {
      const ps = await git.parents('git', tr.path, c4)
      strictEqual(ps.length, 2)
      ok(ps.includes(c2))
      ok(ps.includes(c3))
    })
  })

  describe('message', () => {
    it('returns commit message', async () => {
      equal(await git.message('git', tr.path, c1), 'initial\n')
    })
    it('decodes iso-8859-1 message to utf-8', async () => {
      equal(await git.message('git', tr.path, c5), 'café\n')
    })
  })

  describe('diffTrees', () => {
    it('shows added file between t1 and t2', async () => {
      deepStrictEqual(
        await git.diffTrees('git', tr.path, c1, c2),
        [{ status: 'A', path: 'foo.txt' }],
      )
    })
    it('handles special characters in filenames', { skip: !sp }, async () => {
      const diff = await git.diffTrees('git', tr.path, c1, sp as git.CommitOID)
      const paths = diff.map(e => e.path).sort()
      deepStrictEqual(paths, [
        '"quoted".txt',
        'back\\slash.txt',
      ])
    })
  })

  describe('listTree', () => {
    it('regular blob', async () => {
      const [e] = await git.listTree('git', tr.path, c1, 'README.md')
      strictEqual(e.type, 'blob')
      strictEqual(e.mode, 0o100644)
    })
    it('executable blob', async () => {
      const [e] = await git.listTree('git', tr.path, m1, 'script.sh')
      strictEqual(e.type, 'blob')
      strictEqual(e.mode, 0o100755)
    })
    it('subdirectory tree', async () => {
      const [e] = await git.listTree('git', tr.path, m1, 'subdir')
      strictEqual(e.type, 'tree')
      strictEqual(e.mode, 0o40000)
    })
    it('gitlink', async () => {
      const [e] = await git.listTree('git', tr.path, m1, 'sub')
      strictEqual(e.type, 'commit')
      strictEqual(e.mode, 0o160000)
      strictEqual(e.name, dummy)
    })
    it('double-quoted filename', { skip: !sp }, async () => {
      const [e] = await git.listTree('git', tr.path, sp as git.CommitOID, '"quoted".txt')
      equal(e.path, '"quoted".txt')
    })
    it('backslash in filename', { skip: !sp }, async () => {
      const [e] = await git.listTree('git', tr.path, sp as git.CommitOID, 'back\\slash.txt')
      equal(e.path, 'back\\slash.txt')
    })
    it('symlink', async () => {
      const [e] = await git.listTree('git', tr.path, s1, 'link.txt')
      strictEqual(e.type, 'blob')
      strictEqual(e.mode, 0o120000)
      equal(e.path, 'link.txt')
    })
    it('nested symlink', async () => {
      const [e] = await git.listTree('git', tr.path, s1, 'deep/link')
      strictEqual(e.type, 'blob')
      strictEqual(e.mode, 0o120000)
      equal(e.path, 'deep/link')
    })
  })

  describe('catFile', () => {
    it('returns blob contents', async () => {
      const [entry] = await git.listTree('git', tr.path, c1, 'README.md')
      equal((await git.catFile('git', tr.path, entry.name)).toString(), 'hello\n')
    })
    it('returns staged content, not working tree', async () => {
      tr.writeFile('partial.txt', 'staged\n')
      tr.add('partial.txt')
      tr.writeFile('partial.txt', 'staged\nmodified\n')
      try {
        const [entry] = await git.listIndex('git', tr.path, 'partial.txt')
        const content = (await git.catFile('git', tr.path, entry.name)).toString()
        ok(content.includes('staged'))
        ok(!content.includes('modified'))
      } finally {
        tr.reset('partial.txt')
        tr.rm('partial.txt')
      }
    })
  })

  describe('diffStaged', () => {
    it('empty after read-tree HEAD', async () => {
      deepStrictEqual(await git.diffStaged('git', tr.path, 'HEAD'), [])
    })
    it('shows staged add', async () => {
      tr.writeFile('staged.txt', 'staged\n')
      tr.add('staged.txt')
      try {
        deepStrictEqual(await git.diffStaged('git', tr.path, 'HEAD'), [{ status: 'A', path: 'staged.txt' }])
      } finally {
        tr.reset('staged.txt')
        tr.rm('staged.txt')
      }
    })
  })

  describe('listIndex', () => {
    it('returns staged files', async () => {
      const paths = (await git.listIndex('git', tr.path, '.')).map(e => e.path).sort()
      deepStrictEqual(paths, ['README.md', 'foo.txt'])
    })
  })

  describe('invalid arguments', () => {
    async function assertGitError(p: Promise<unknown>): Promise<void> {
      await rejects(p, (e: unknown) => {
        ok(e instanceof Error, 'expected Error')
        ok(!(e instanceof git.GitParseError))
        ok(!e.message.includes('GitParseError'), `unexpected "GitParseError" in: ${e.message}`)
        ok(e.message.includes('exit status'), `expected "exit status" in: ${e.message}`)
        return true
      })
    }
    it('commits rejects nonexistent ref', async () => {
      await assertGitError(git.commits('git', tr.path, 'refs/heads/nonexistent'))
    })
    it('parents rejects bad oid', async () => {
      await assertGitError(git.parents('git', tr.path, 'notanoid' as git.CommitOID))
    })
    it('message rejects bad oid', async () => {
      await assertGitError(git.message('git', tr.path, 'notanoid' as git.CommitOID))
    })
    it('diffTrees rejects bad oids', async () => {
      await assertGitError(git.diffTrees('git', tr.path, 'bad1' as git.TreeOID, 'bad2' as git.TreeOID))
    })
    it('listTree rejects bad oid', async () => {
      await assertGitError(git.listTree('git', tr.path, 'bad' as git.TreeOID, ''))
    })
    it('catFile rejects bad oid', async () => {
      await assertGitError(git.catFile('git', tr.path, 'bad' as git.BlobOID))
    })
    it('diffStaged rejects bad tree', async () => {
      await assertGitError(git.diffStaged('git', tr.path, 'bad' as git.TreeOID))
    })
  })

  describe('repo', () => {
    const funcs = [
      'head',
      'commits',
      'parents',
      'message',
      'diffTrees',
      'listTree',
      'catFile',
      'diffStaged',
      'listIndex',
    ]
    it('has the git version', async () => {
      const repo = await git.repo('git', tr.path)
      ok(repo.version)
    })
    it('resolves the absolute git dir path', async () => {
      const repo = await git.repo('git', tr.path)
      ok(isAbsolute(repo.gitDir), 'gitDir is absolute')
      pathEqual(repo.gitDir, tr.gitDir)
    })
    it('works within a subdirectory', async () => {
      const repo = await git.repo('git', join(tr.path, 'emptydir'))
      pathEqual(repo.gitDir, tr.gitDir)
    })
    it('returns a wrapper around the repo functions', async () => {
      const repo = await git.repo('git', tr.path)
      for (const name of funcs) {
        ok(Object.hasOwn(repo, name), name)
      }
    })
    it('fails if not a git dir', async () => {
      await rejects(git.repo('git', join(tr.path, '..')), /not a git repository/)
    })
  })
})

function pathEqual(a: string, b: string, message?: string | Error): void {
  // git on windows may return forward slash paths
  // node on windows may return 8.3 filenames
  a = realpathSync.native(normalize(a))
  b = realpathSync.native(normalize(b))
  equal(a, b, message)
}
