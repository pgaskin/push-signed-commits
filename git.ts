import { spawn } from 'node:child_process'

/** Git object types from object.h. */
export const objectType = {
  1: 'commit',
  2: 'tree',
  3: 'blob',
  4: 'tag',
  6: 'ofs_delta',
  7: 'ref_delta',
} as const

/** Git object type name. */
export type GitObjectType = typeof objectType[keyof typeof objectType]

/** Used for nominal typing only. Not an actual property. */
const __objectType = Symbol("git object")

/** Git object hash. */
export type TypedOID<T extends GitObjectType> = string & { readonly [__objectType]: T }
export type OIDType<T extends TypedOID<GitObjectType>> = T[typeof __objectType]
export type OID = TypedOID<GitObjectType>
export type TreeOID = TypedOID<'tree'>
export type CommitOID = TypedOID<'commit'>
export type BlobOID = TypedOID<'blob'>
export type TagOID = TypedOID<'tag'>

/** OIDs peelable to a tree. */
export type TreeishOID = TypedOID<'tree' | 'commit' | 'blob'>

/** OIDs peelable to a commit. */
export type CommittishOID = TypedOID<'commit' | 'tag'>

/** An incomplete subset of revisions guaranteed to be treeish if they exist. */
export type Treeish = "HEAD" | PeeledRev<OIDType<TreeishOID>> | TreeishOID

/** An incomplete subset of revisions guaranteed to be committish if they exist. */
export type Committish = "HEAD" | PeeledRev<OIDType<CommittishOID>> | CommittishOID

/** An explicitly peeled revision (git will treat is as not found if not the expected object type). */
export type PeeledRev<T extends GitObjectType> = `${string}^{${T}}`

/** Returns revision peeled to the specified type. */
export function peeledRev<T extends GitObjectType>(revision: string, type: T): PeeledRev<T> {
  return `${revision}^{${type}}`
}

/** Git diff status character. */
export type GitDiffStatus = typeof diffStatus[keyof typeof diffStatus]

/** Git DIFF_STATUS_ constants from diff.h, but flipped for convenience. */
export const diffStatus = {
  added: 'A',
  copied: 'C',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  typeChanged: 'T',
  unknown: 'X',
  unmerged: 'U',
} as const

// I might have gone a bit crazy with the typing here, but it was fun, I learned
// a bit, and now correctness is enforced ¯\_(ツ)_/¯
//
// I've chosen to make the types a bit stronger than strictly required, but I
// think it's nicer this way

export const [minGitMajor, minGitMinor] = [2, 38]

export class GitParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitParseError'
  }
}

export async function version(git: string): Promise<string> {
  const out = await run(false, git, 'version')
  const line = out.next()
  if (line.done) {
    throw new GitParseError(`Bad git version output ${out}`)
  }
  const match = /^git version (\S+)$/.exec(line.value)
  if (!match) {
    throw new GitParseError(`Bad git version line ${line.value}`)
  }
  return match[1]
}

export async function checkVersion(git: string): Promise<{
  version: string,
  compatible: boolean | undefined,
}> {
  const ver = await version(git)
  const match = /^(\d+)[.](\d+)[.](\d+)$/.exec(ver)
  let compatible
  if (match) {
    const major = parseInt(match[1])
    const minor = parseInt(match[2])
    compatible = major > minGitMajor || (major == minGitMajor && minor >= minGitMinor)
  }
  return {
    version: ver,
    compatible,
  }
}

export async function head(git: string): Promise<CommitOID> {
  const out = await run(false, git, 'rev-parse', '--verify', 'HEAD')
  for (const oid of out) {
    parseOID<CommitOID>(oid)
    return oid
  }
  throw new GitParseError(`Expected oid for successful rev-parse, got nothing`)
}

export async function commits(git: string, revision: string): Promise<CommitOID[]> {
  const out = await run(false, git,
    'rev-list',         // verify revs, list commits between them, and resolve them to their commit hash
    '-z',               // null-terminated output
    '--no-walk',        // if a single rev is specified, only resolve that one; ignored if a range is specified
    '--first-parent',   // only follow the first parent of merge commits (we'll filter those out later anyways)
    '--end-of-options', // prevent rev from being parsed as an option
    revision,           // rev
    '--',               // prevent rev from being parsed as a path
  )
  const oids = []
  for (const oid of out) {
    parseOID<CommitOID>(oid)
    oids.push(oid)
  }
  return oids
}

export async function parents(git: string, commit: Committish): Promise<CommitOID[]> {
  const out = await run(false, git, 'rev-parse', commit + '^@') // unlike sha^, this will not fail if a commit has no parents
  const oids = []
  for (const oid of out) {
    parseOID<CommitOID>(oid)
    oids.push(oid)
  }
  return oids
}

export async function message(git: string, commit: Committish): Promise<string> {
  const out = await run(false, git,
    '-c', 'i18n.logOutputEncoding=UTF-8', // if the commit message is not UTF-8, re-encode it
    'show',                               // show a formatted object
    '-s',                                 // only what we ask for, not the entire diff
    '--format=%B',                        // raw commit message
    '--end-of-options',                   // no more options
    commit,                               // commit
  )
  let msg = out.all()
  if (msg.length) {
    if (!msg.endsWith('\n')) {
      throw new GitParseError(json`Expected git show to append a newline to the raw commit message, but didn't find one: ${msg}`)
    }
    msg = msg.slice(0, -1)
  }
  return msg
}

export type GitDiffEntry = {
  status: GitDiffStatus,
  path: string,
}

export async function diffStaged(git: string, tree: Treeish): Promise<GitDiffEntry[]> {
  const out = await run(false, git,
    'diff-index',       // low-level tree diff
    '-z',               // null-terminated
    '-r',               // recurse into trees (and don't return the trees themselves)
    '--name-status',    // only status and paths
    '--cached',         // only index (i.e.,  staging area), not working tree files
    '--end-of-options', // no more options
    tree,               // target
  )
  return parseDiff(out)
}

export async function diffTrees(git: string, a: Treeish, b: Treeish): Promise<GitDiffEntry[]> {
  const out = await run(false, git,
    'diff-tree',        // low-level tree diff
    '-z',               // null-terminated
    '-r',               // recurse into trees (and don't return the trees themselves)
    '--name-status',    // only status and paths
    '--end-of-options', // no more options
    a, b,               // trees
  )
  return parseDiff(out)
}

async function parseDiff(out: GitOutput): Promise<GitDiffEntry[]> {
  const diff = []
  for (const status of out) {
    const path = out.next()
    if (path.done) {
      throw new GitParseError(json`Expected path after diff status ${status}`)
    }
    parseDiffStatus(status, path.value)
    diff.push({
      status: status,
      path: path.value,
    })
  }
  return diff
}

export type GitTreeEntry = {
  [T in GitObjectType]: {
    type: T,
    mode: number,
    name: TypedOID<T>,
    size: number,
    path: string,
  }
}[GitObjectType]

export async function listIndex(git: string, path: string): Promise<GitTreeEntry[]> {
  const out = await run(false, git,
    'ls-files',                    // information about a tree object in the index and working directory
    '-z',                          // null terminated
    '--cached',                    // only index (i.e.,  staging area), not working tree files
    `--format=${parseTreeFormat}`, // fields
    '--end-of-options',            // escape
    path,                          // path
  )
  return parseTree(out, false)
}

export async function listTree(git: string, tree: TreeishOID, path: string): Promise<GitTreeEntry[]> {
  const out = await run(false, git,
    'ls-tree',                     // information about a tree object in the repository
    '-z',                          // null terminated
    `--format=${parseTreeFormat}`, // fields
    '--end-of-options',            // escape
    tree,                          // tree object
    path,                          // path
  )
  return parseTree(out, true)
}

const parseTreeFormat = `%(objecttype)%x00%(objectmode)%x00%(objectname)%x00%(objectsize)%x00%(path)`

function parseTree(out: GitOutput, quoted: boolean): GitTreeEntry[] {
  const ent = []
  for (const type of out) {
    parseType(type)
    const modeStr = out.next()
    if (modeStr.done) {
      throw new GitParseError(json`Expected mode after tree entry type ${type}`)
    }
    const mode = parseInt(modeStr.value, 10)
    if (isNaN(mode) || !Number.isInteger(mode)) {
      throw new GitParseError(json`Invalid mode ${modeStr}`)
    }
    const name = out.next()
    if (name.done) {
      throw new GitParseError(json`Expected mode after tree entry mode ${modeStr}`)
    }
    parseOID<TypedOID<any>>(name.value)
    const sizeStr = out.next()
    if (sizeStr.done) {
      throw new GitParseError(json`Expected mode after tree entry name ${name}`)
    }
    const size = sizeStr.value === '-' ? -1 : parseInt(sizeStr.value, 10)
    if (isNaN(size) || !Number.isInteger(size)) {
      throw new GitParseError(json`Invalid size ${sizeStr}`)
    }
    const path = out.next()
    if (path.done) {
      throw new GitParseError(json`Expected mode after tree size ${sizeStr}`)
    }
    ent.push({
      type: type,
      mode: mode,
      name: name.value,
      size: size,
      // git ls-tree always quotes it with --format (quote_c_style in
      // show_tree_fmt) even if core.quotePath is disabled and/or -z is
      // specified (ls-files doesn't)
      path: (quoted && path.value.includes('"')) ? unquote(path.value) : path.value,
    })
  }
  return ent
}

export async function catFile(git: string, oid: OID): Promise<Buffer> {
  return await run(true, git, 'cat-file', '-p', '--end-of-options', oid)
}

interface GitOutput extends IteratorObject<string, void, void> {
  /** Get the next newline/null-delimited (depending on -z) item. */
  next(): IteratorResult<string, void>
  /** Get the entire UTF-8 output. */
  all(): string
}

function run<T extends boolean>(raw: T, git: string, ...args: string[]): Promise<T extends true ? Buffer : GitOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(git, args)
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', err => reject(err))
    child.on('close', (code, signal) => {
      if (code) reject(new Error(json`git ${args}: exit status ${code} (stderr: ${Buffer.concat(stderr).toString('utf-8')})`))
      else if (signal) reject(new Error(`git ${args}: killed by signal ${signal} (stderr: ${Buffer.concat(stderr).toString('utf-8')})`))
      let out: any = Buffer.concat(stdout)
      if (!raw) {
        const all = out.toString('utf-8')
        out = function* (str) {
          const delim = args.includes('-z') ? '\x00' : '\n'
          while (str.length) {
            const i = str.indexOf(delim)
            if (i == -1) {
              throw new GitParseError(json`Got garbage ${str} after last ${delim}`)
            }
            const it = str.slice(0, i)
            str = str.slice(i + 1)
            yield it
          }
        }(all)
        out = Object.defineProperty(out, 'all', {
          value: () => all,
          enumerable: false,
          writable: true,
          configurable: true,
        })
      }
      resolve(out)
    })
  })
}

const diffStatusSet: Set<string> = new Set(Object.values(diffStatus))

function parseDiffStatus(status: string, path?: string | undefined): asserts status is GitDiffStatus {
  if (!diffStatusSet.has(status)) {
    throw new GitParseError(json`Invalid diff status ${status}` + (path ? json`for file ${path}` : ''))
  }
}

const objectTypeSet: Set<string> = new Set(Object.values(objectType))

function parseType(type: string, path?: string | undefined): asserts type is GitObjectType {
  if (!objectTypeSet.has(type)) {
    throw new GitParseError(json`Invalid object type ${type}` + (path ? json`for file ${path}` : ''))
  }
}

function parseOID<T extends OID>(oid: string): asserts oid is T {
  if (!/^[a-f0-9]+$/.test(oid)) {
    throw new GitParseError(json`Invalid OID ${oid}`)
  }
  if (oid.length != 40 && oid.length != 64) {
    throw new GitParseError(json`Invalid OID ${oid} length ${oid.length}`)
  }
}

/**
 * Split message into the subject and body for pretty-printing according to
 * git's rules (see git/pretty.c format_subject), does NOT merge the subject
 * into a single line (so subject isn't exactly equal to --format=%s).
 */
export function splitCommitMessage(message: string): {
  subject: string,
  body: string,
} {
  message = trimBlankLinesStart(message)
  let [subject, body] = cutBlankLine(message)
  subject = trimBlankLinesEnd(subject)
  body = trimBlankLinesStart(body)
  body = trimBlankLinesEnd(body)
  return { subject, body }
}

function trimBlankLinesStart(s: string): string {
  while (true) {
    const i = s.indexOf('\n')
    if (i == -1) {
      return s
    }
    if (!isSpaceASCII(s.slice(0, i))) {
      return s
    }
    s = s.slice(i + 1)
  }
}

function trimBlankLinesEnd(s: string): string {
  while (true) {
    const i = s.lastIndexOf('\n')
    if (i == -1) {
      return s
    }
    if (!isSpaceASCII(s.slice(i + 1))) {
      return s
    }
    s = s.slice(0, i)
  }
}

function cutBlankLine(s: string): [string, string] {
  let rest = s
  while (true) {
    const i = rest.indexOf('\n')
    if (i == -1) {
      return [s, '']
    }
    if (isSpaceASCII(rest.slice(0, i))) {
      return [s.slice(0, s.length - rest.length), rest.slice(i + 1)]
    }
    rest = rest.slice(i + 1)
  }
}

function isSpaceASCII(s: string): boolean {
  return /^[ \t\n\v\f\r]*$/.test(s)
}

/** Unquote a double-quoted C string. */
function unquote(str: string): string {
  if (!str.startsWith('"') || !str.endsWith('"')) {
    throw new GitParseError(json`Expected ${str} to be quoted by git, but it wasn't`)
  }
  str = str.slice(1, -1)
  const bytes: number[] = []
  for (let i = 0; i < str.length; ) {
    if (str[i] !== '\\') {
      bytes.push(str.charCodeAt(i++))
    } else {
      const e = str[i + 1]
      if (e >= '0' && e <= '7') {
        let j = i + 1
        while (j < i + 4 && j < str.length && str[j] >= '0' && str[j] <= '7') j++
        bytes.push(parseInt(str.slice(i + 1, j), 8))
        i = j
      } else {
        switch (e) {
          case '\\': bytes.push(0x5c); break
          case '/':  bytes.push(0x2f); break
          case '"':  bytes.push(0x22); break
          case 'a':  bytes.push(0x07); break
          case 'b':  bytes.push(0x08); break
          case 'f':  bytes.push(0x0c); break
          case 'n':  bytes.push(0x0a); break
          case 'r':  bytes.push(0x0d); break
          case 't':  bytes.push(0x09); break
          case 'v':  bytes.push(0x0b); break
          default:   bytes.push(e.charCodeAt(0)); break
        }
        i += 2
      }
    }
  }
  return Buffer.from(bytes).toString('utf-8')
}

export const __test = {
  trimBlankLinesStart,
  trimBlankLinesEnd,
  cutBlankLine,
  unquote,
}

function json(strings: TemplateStringsArray, ...values: any[]) {
  return strings.reduce((acc, str, i) => acc + str + (i < values.length ? JSON.stringify(values[i]) : ''), '');
}
