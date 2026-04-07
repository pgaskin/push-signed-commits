import { suite, describe, it, after } from 'node:test'
import { equal, deepEqual, ok, rejects } from 'node:assert'
import * as git from './git.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

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
})

repoSuite('git (repo)', fi => {
  // printf '%s\n' 'commit refs/heads/target' 'mark :1' 'committer T <t@t> 999999999 +0000' 'data 7' 'anchor' 'M 100644 inline .keep' 'data 0' '' '' | git fast-import --quiet && git rev-parse refs/heads/target && git update-ref -d refs/heads/target`
  const tg = '8bb997792df216d2c6ffda748dfd6e43d6254dd1'

  /*
  * target:  small orphan commit to test gitlinks
  * main:    C1 (README.md) -> C2 (+foo.txt)
  * feature: C1 -> C3 (+bar.txt)
  * merge:   merge of C2+C3
  * misc:    C1 -> (+script.sh exec, +subdir/deep.txt, +sub gitlink->TARGET)
  * utf16:   C2 -> iso-8859-1 encoded message
  */
  fi.commit('refs/heads/target', 999_999_999, 'anchor\n', [], [{ path: '.keep', content: '' }])
  const c1m = fi.commit('refs/heads/main', 1_000_000_000, 'initial\n', [], [{ path: 'README.md', content: 'hello\n' }])
  const c2m = fi.commit('refs/heads/main', 1_000_000_001, 'second\n', [c1m], [{ path: 'foo.txt', content: 'foo\n' }])
  const c3m = fi.commit('refs/heads/feature', 1_000_000_002, 'feature\n', [c1m], [{ path: 'bar.txt', content: 'bar\n' }])
  fi.commit('refs/heads/merge', 1_000_000_003, 'merge\n', [c2m, c3m], [])
  fi.commit('refs/heads/misc', 1_000_000_004, 'misc\n', [c1m], [
    { path: 'script.sh', content: '#!/bin/sh\n', exec: true },
    { path: 'subdir/deep.txt', content: 'deep\n' },
    { path: 'sub', gitlink: tg },
  ])
  fi.commit('refs/heads/utf16', 1_000_000_005, Buffer.from('caf\xe9\n', 'latin1'), [c2m], [], 'ISO-8859-1')
}, tr => {
  tr.git(['read-tree', 'refs/heads/main'])
  const tg = tr.revParse(git.peeledRev('refs/heads/target', 'commit'))
  const c1 = tr.revParse(git.peeledRev('refs/heads/main~1', 'commit'))
  const c2 = tr.revParse(git.peeledRev('refs/heads/main', 'commit'))
  const c3 = tr.revParse(git.peeledRev('refs/heads/feature', 'commit'))
  const c4 = tr.revParse(git.peeledRev('refs/heads/merge', 'commit'))
  const c5 = tr.revParse(git.peeledRev('refs/heads/utf16', 'commit'))
  const t1 = tr.revParse(git.peeledRev('refs/heads/main~1', 'tree'))
  const t2 = tr.revParse(git.peeledRev('refs/heads/main', 'tree'))
  const tm = tr.revParse(git.peeledRev('refs/heads/misc', 'tree'))

  describe('version', () => {
    it('returns a version string', async () => {
      ok(/\d+\.\d+/.test(await git.version('git')))
    })
    it('checkVersion is compatible', async () => {
      ok((await git.checkVersion('git')).compatible)
    })
  })

  describe('head', () => {
    it('returns tip of main', async () => {
      equal(await git.head('git'), c2)
    })
  })

  describe('commits', () => {
    it('single rev resolves to tip', async () => {
      deepEqual(await git.commits('git', 'refs/heads/main'), [c2])
    })
    it('range', async () => {
      deepEqual(await git.commits('git', `${c1}..${c2}`), [c2])
    })
  })

  describe('parents', () => {
    it('root commit has none', async () => {
      deepEqual(await git.parents('git', c1), [])
    })
    it('second commit has one parent', async () => {
      deepEqual(await git.parents('git', c2), [c1])
    })
    it('merge commit has two parents', async () => {
      const ps = await git.parents('git', c4)
      equal(ps.length, 2)
      ok(ps.includes(c2))
      ok(ps.includes(c3))
    })
  })

  describe('message', () => {
    it('returns commit message', async () => {
      equal(await git.message('git', c1), 'initial\n')
    })
    it('decodes iso-8859-1 message to utf-8', async () => {
      equal(await git.message('git', c5), 'café\n')
    })
  })

  describe('diffTrees', () => {
    it('shows added file between t1 and t2', async () => {
      deepEqual(
        await git.diffTrees('git', t1, t2),
        [{ status: 'A', path: 'foo.txt' }],
      )
    })
  })

  describe('listTree', () => {
    it('regular blob', async () => {
      const [e] = await git.listTree('git', t1, 'README.md')
      equal(e.type, 'blob')
      equal(e.mode, 100644)
    })
    it('executable blob', async () => {
      const [e] = await git.listTree('git', tm, 'script.sh')
      equal(e.type, 'blob')
      equal(e.mode, 100755)
    })
    it('subdirectory tree', async () => {
      const [e] = await git.listTree('git', tm, 'subdir')
      equal(e.type, 'tree')
      equal(e.mode, 40000)
    })
    it('gitlink', async () => {
      const [e] = await git.listTree('git', tm, 'sub')
      equal(e.type, 'commit')
      equal(e.mode, 160000)
      equal(e.name, tg)
    })
  })

  describe('catFile', () => {
    it('returns blob contents', async () => {
      const [entry] = await git.listTree('git', t1, 'README.md')
      equal((await git.catFile('git', entry.name)).toString(), 'hello\n')
    })
    it('returns staged content, not working tree', async () => {
      tr.writeFile('partial.txt', 'staged\n')
      tr.add('partial.txt')
      tr.writeFile('partial.txt', 'staged\nmodified\n')
      try {
        const [entry] = await git.listIndex('git', 'partial.txt')
        const content = (await git.catFile('git', entry.name)).toString()
        ok(content.includes('staged'))
        ok(!content.includes('modified'))
      } finally {
        tr.reset('partial.txt')
        tr.removeFile('partial.txt')
      }
    })
  })

  describe('diffStaged', () => {
    it('empty after read-tree HEAD', async () => {
      deepEqual(await git.diffStaged('git', 'HEAD'), [])
    })
    it('shows staged add', async () => {
      tr.writeFile('staged.txt', 'staged\n')
      tr.add('staged.txt')
      try {
        deepEqual(await git.diffStaged('git', 'HEAD'), [{ status: 'A', path: 'staged.txt' }])
      } finally {
        tr.reset('staged.txt')
        tr.removeFile('staged.txt')
      }
    })
  })

  describe('listIndex', () => {
    it('returns staged files', async () => {
      const paths = (await git.listIndex('git', '.')).map(e => e.path).sort()
      deepEqual(paths, ['README.md', 'foo.txt'])
    })
  })

  describe('invalid arguments', () => {
    async function assertGitError(p: Promise<unknown>): Promise<void> {
      await rejects(p, (e: unknown) => {
        ok(e instanceof Error, 'expected Error')
        ok(e.message.includes('exit status'), `expected "exit status" in: ${e.message}`)
        ok(!e.message.includes('GitParseError'), `unexpected "GitParseError" in: ${e.message}`)
        return true
      })
    }
    it('commits rejects nonexistent ref', async () => {
      await assertGitError(git.commits('git', 'refs/heads/nonexistent'))
    })
    it('parents rejects bad oid', async () => {
      await assertGitError(git.parents('git', 'notanoid' as git.CommitOID))
    })
    it('message rejects bad oid', async () => {
      await assertGitError(git.message('git', 'notanoid' as git.CommitOID))
    })
    it('diffTrees rejects bad oids', async () => {
      await assertGitError(git.diffTrees('git', 'bad1' as git.TreeOID, 'bad2' as git.TreeOID))
    })
    it('listTree rejects bad oid', async () => {
      await assertGitError(git.listTree('git', 'bad' as git.TreeOID, ''))
    })
    it('catFile rejects bad oid', async () => {
      await assertGitError(git.catFile('git', 'bad' as git.BlobOID))
    })
    it('diffStaged rejects bad tree', async () => {
      await assertGitError(git.diffStaged('git', 'bad' as git.TreeOID))
    })
  })
})

type FastImportFile =
  | { path: string, content: string, exec?: boolean }
  | { path: string, gitlink: string }

class FastImport {
  private chunks: Buffer[] = []
  private mark = 1

  private text(s: string): void {
    this.chunks.push(Buffer.from(s, 'utf-8'))
  }

  commit(ref: string, ts: number, msg: string | Buffer, parents: number[], files: FastImportFile[], encoding?: string): number {
    const mark = this.mark++
    {
      const header = [
        `commit ${ref}`,
        `mark :${mark}`,
        `committer T <t@t> ${ts} +0000`,
      ]
      if (encoding) header.push(`encoding ${encoding}`)
      this.text(header.join('\n') + '\n')
    }
    {
      const msgBuf = typeof msg === 'string' ? Buffer.from(msg, 'utf-8') : msg
      this.text(`data ${msgBuf.byteLength}\n`)
      this.chunks.push(msgBuf)
    }
    if (parents.length) {
      this.text(`from :${parents[0]}\n`)
    }
    for (const p of parents.slice(1)) {
      this.text(`merge :${p}\n`)
    }
    for (const f of files) {
      if ('gitlink' in f) {
        this.text(`M 160000 ${f.gitlink} ${f.path}\n`)
      } else {
        const cb = Buffer.from(f.content, 'utf-8')
        this.text(`M ${f.exec ? '100755' : '100644'} inline ${f.path}\n`)
        this.text(`data ${cb.byteLength}\n`)
        this.chunks.push(cb)
      }
    }
    this.text('\n')
    return mark
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

class TempRepo implements Disposable {
  readonly path: string

  constructor(fi: FastImport) {
    this.path = mkdtempSync(join(tmpdir(), 'git-test-'))
    this.git(['init', '-q', '--initial-branch=main', '.'])
    this.git(['config', 'core.autocrlf', 'false'])
    this.git(['fast-import', '--quiet'], fi.toBuffer())
  }

  git(args: string[], input?: Buffer): void {
    const r = spawnSync('git', ['-C', this.path, ...args], input !== undefined ? { input } : { encoding: 'utf-8' as const })
    if (r.status !== 0) throw new Error(`git ${JSON.stringify(args)}: exit status ${r.status}: ${Buffer.isBuffer(r.stderr) ? r.stderr.toString('utf-8') : r.stderr}`)
  }

  writeFile(path: string, content: string): void {
    const full = join(this.path, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  removeFile(path: string): void {
    rmSync(join(this.path, path))
  }

  add(...paths: string[]): void {
    this.git(['add', '--', ...paths])
  }

  reset(...paths: string[]): void {
    this.git(['reset', '--', ...paths])
  }

  revParse<T extends git.GitObjectType>(rev: git.PeeledRev<T>): git.TypedOID<T> {
    const r = spawnSync('git', ['-C', this.path, 'rev-parse', '--verify', rev], { encoding: 'utf-8' })
    if (r.status !== 0) throw new Error(`git rev-parse ${rev}: ${r.stderr}`)
    return r.stdout.trim() as git.TypedOID<T>
  }

  [Symbol.dispose](): void {
    rmSync(this.path, { recursive: true, force: true })
  }
}

async function repoSuite(name: string, setup: (fi: FastImport) => void, fn: (tr: TempRepo) => void): Promise<void> {
  const { compatible } = await git.checkVersion('git')
  suite(name, { skip: compatible === false ? 'incompatible git version' : undefined }, () => {
    const fi = new FastImport()
    setup(fi)
    const tr = new TempRepo(fi)
    const savedCwd = process.cwd()
    process.chdir(tr.path)
    after(() => {
      process.chdir(savedCwd);
      tr[Symbol.dispose]()
    })
    fn(tr)
  })
}
