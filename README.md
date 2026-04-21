# push-signed-commits

Create verified/signed commits as bots or GitHub Actions.

### Quick Start

```yaml
# with the github actions token
- uses: pgaskin/push-signed-commits@v1.0.2
  with:
    commit-message: commit message
```

```yaml
# with a github app installation token
- uses: pgaskin/push-signed-commits@v1.0.2
  with:
    path: other-repo
    repository: username/other-repo
    branch: master
    commit-message: commit message
    app-id: ${{ vars.app_id }}
    app-key: ${{ secrets.app_private_key }}
```

```bash
# with a github token (cli)
GITHUB_TOKEN=github_pat_xxx npx -y push-signed-commits@v1.0.2 -m 'commit message' username/repo master
```

```bash
# with a github app installation token (cli)
APP_PRIVATE_KEY="$(< private.pem)" npx -y push-signed-commits@v1.0.2 -C other-repo -m 'commit message' --app 1234 username/other-repo master
```

```bash
# as a library
npm install --save push-signed-commits@v1.0.2
```

### Features


This tool is cross-platform and available as a:
- [GitHub Action](https://github.com/marketplace/actions/push-signed-commits)
- [CLI tool](https://github.com/pgaskin/push-signed-commits#cli)
- [Library](https://www.npmjs.com/package/push-signed-commits)

The only dependencies are git 2.24+ (released on 2019-11-04) and node 24+.

Authentication is done with either:
- A GitHub Actions token.
- A GitHub App installation token (it can be automatically created and revoked for you).
- A personal access token.

Commits can be specified as:
- A new commit from the staged changes.
- A single commit.
- A [range](https://git-scm.com/docs/gitrevisions) of commits.

Commits created with this action:
- Will have a different commit hash.
- Will be signed and committed by GitHub with the current time.
- Will be authored by the owner of the token with the current time.
- Preserves the original commit message (it will be converted to utf-8 if in a different encoding).
- Preserves all file content and attributes, including binaries and [unusual](https://git-scm.com/docs/git-config#Documentation/git-config.txt-corequotePath) file names with spaces or special characters.

The [`createCommitOnBranch`](https://docs.github.com/en/graphql/reference/mutations#createcommitonbranch) does not support creating new branches, or creating commits which contain:
- Extremely large files.
- Multiple parents (i.e., merge commits).
- Symbolic links.
- Submodules.
- Non-regular (i.e., executable) files.

If the GraphQL mutation fails, this action will attempt to use the REST API instead. The REST API fallback is not supported for non-app/actions tokens because GitHub won't sign commits created using the REST API with personal access tokens. Since the REST API generally uses more of your rate limit, it can be disabled with the `no-rest-fallback` option.

Pushing commits with multiple parents (i.e., merge commits) is entirely unsupported and will fail.

If pushing a range of commits, it will push as many as it can before failing on one with unsupported content.

The newly created commits will not be automatically pulled, but the new hashes are returned and can be used to update the local repository with `git reset --soft` after fetching them.

This tool is very robust:
- All input is validated and all errors are checked.
- The behaviour is not affected by differences in the local git config, including:
  - Working tree line ending conversions (e.g.,[`core.autocrlf`](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coreautocrlf)).
  - Diff configuration (e.g., [`diff.renames`](https://git-scm.com/docs/git-config#Documentation/git-config.txt-diffrenames))
  - Commit message encoding (e.g., [`i18n.commitEncoding`](https://git-scm.com/docs/git-config#Documentation/git-config.txt-i18ncommitEncoding))
- Retries failed API calls with automatic throttling.
- Comprehensive test suite.
- Tested on Linux, Windows, and macOS.
- 100% hand-coded and tested.
- Release tags are immutable.
- Uses NPM trusted publishing.
- Zero NPM dependencies.
- Follows semantic versioning.

### Usage

#### GitHub Actions

##### Inputs

<!--{inputs}-->

```yaml
- uses: pgaskin/push-signed-commits@v1.0.2
  with:

    # The local repository path relative to the current directory. If you change
    # this, you probably also want to change the 'repository' and 'branch'.
    path: ''

    # The target repository username/name if not the same as the workflow. This
    # does not need to match the local repo upstream. If not on the same GitHub
    # server as the workflow, you need to override the GITHUB_API_URL and
    # GITHUB_GRAPHQL_URL environment variables.
    repository: ${{ github.repository }}

    # The target branch name if not the same as the workflow ref, optionally
    # including the 'refs/heads/' prefix. This does not need to match the local
    # repo branch. You cannot push to tags.
    branch: ${{ github.ref }}

    # The commit or commit range to push to the remote. If you want to push the
    # last local commit, use 'HEAD'. If the local branch has an upstream set,
    # you can use 'HEAD@{u}..HEAD' to push all commits added since the last
    # pull. Note that force-pushes are not supported and will be rejected. See
    # https://git-scm.com/docs/gitrevisions. If not set, a new commit will be
    # created from the staging area.
    revision: ''

    # Whether to make a new commit from the staging area even if there's nothing
    # to commit. Only used if 'revision' is not set.
    allow-empty: false

    # The commit message to use if creating a new commit from the staging area.
    commit-message: 'automatic commit'

    # The file to read the commit message from. Overrides commit-message.
    commit-message-file: ''

    # Override the user agent used to make GitHub API requests.
    user-agent: ''

    # Do not validate SSL certificates when making GitHub API requests.
    insecure: false

    # Do not push commits, just print the mutations which would be made.
    dry-run: false

    # The token to use to make GitHub API requests.
    github-token: ${{ github.token }}

    # GitHub API URL. If not set, it will be set from GITHUB_API_URL to be the
    # same as the one where the workflow is running from (e.g.,
    # https://api.github.com or https://my-ghes-server.example.com/api/v3).
    github-api-url: ''

    # GitHub GraphQL API URL. If not set, it will be set from GITHUB_GRAPHQL_URL
    # to be the same as the one where the workflow is running from (e.g.,
    # https://api.github.com/graphql or
    # https://my-ghes-server.example.com/api/graphql).
    github-graphql-url: ''

    # Authenticate as a GitHub App with the specified ID. The installation ID
    # will be detected based on 'repository'. Overrides 'github-token'. The app
    # must have the 'contents:write' permission. If you already have an app
    # installation token, you can pass it via 'github-token' instead.
    app-id: ''

    # The private key to use if authenticating as a GitHub App. Can be
    # base64-encoded or contain escaped ('\n') newlines.
    app-key: ''

    # Do not attempt to use the REST API to create new branches, or to create
    # commits which can't be represented using the GraphQL API. Note that
    # creating commits via the REST API generally uses more of your rate limit.
    # Signing only works with GitHub App tokens (including the one from GitHub
    # Actions), not personal access tokens, and if the commit wasn't signed
    # successfully, an error will be thrown by this action.
    no-rest-fallback: false

    # The git binary to use. If not sepecified, the one in the PATH is used.
    git-binary: ''
```

<!--{/inputs}-->

##### Outputs

<!--{outputs}-->

- `not-pushable` \
  Set to true if one or more commits were not pushed (the oid outputs will
  still be set to the ones pushed so far) since they contained unpushable
  content.

- `pushed-oids` \
  The new commit hash of all commits pushed, space-separated. On failure, it
  contains the ones pushed so far. Not set if 'dry-run'.

- `pushed-oid` \
  The new commit hash of the last commit pushed, or an empty string if no
  commits were pushed. On failure, it contains the ones pushed so far. Not
  set if 'dry-run'.

- `local-commit-oids` \
  The local commit hashes of all commits pushed corresponding to the ones in
  commit-oids. Not set if creating a new commit from the staging area. Still
  set if 'dry-run'.

- `local-commit-oid` \
  The local commit hashes of the last commit pushed corresponding to the
  ones in commit-oids. Not set if creating a new commit from the staging
  area. Still set if 'dry-run'.

<!--{/outputs}-->

#### CLI

<!--{cli}-->

```
usage: npx -y push-signed-commits@v1.0.2 [options] username/repository target_branch [revision]

      --allow-empty             create en empty commit even if there are no changes
  -m, --message message         commit message to use if creating a new commit from the staging area
  -F, --file path               read the commit message from the specified (overrides --message)
  -A, --user-agent str          override the user agent for GitHub API requests (default "push-signed-commits/1.0.2")
  -k, --insecure                do not validate check tls certificates for GitHub API requests
  -n, --dry-run                 do not actually push commits, just print the mutations
      --github-token token      github token with contents:write permission (env GITHUB_TOKEN)
      --github-api-url url      github api url (env GITHUB_API_URL) (default "https://api.github.com")
      --github-grqphql-url url  github graphql api url (env GITHUB_GRAPHQL_URL) (default "https://api.github.com/graphql")
      --app id                  authenticate as a github app with the specified id (overrides --github-token)
      --app-key pem             the private key to use if authenticating as a github app (can be base64-encoded or contain escaped newlines) (env APP_PRIVATE_KEY)
      --no-rest-fallback        do not attempt to use the rest api to create new branches or to create commits which cannot be represented with the graphql api (see the README for more info)
      --git cmd                 the git executable to use (default "git")
  -h, --help                    show this help text
  -v, --verbose                 show debug output
  -C  path                      repository path (default ".")

revision is a commit or range of commits (see man gitrevisions(7))
if not specified, a commit is created from the staging area
```

<!--{/cli}-->

#### Library

See [`./lib/index.ts`](./lib/index.ts).

### Examples

#### Create and push a commit if there are staged changes

```yaml
- uses: pgaskin/push-signed-commits@v1.0.2
  with:
    commit-message: |
      commit message subject

      commit message body
```

```bash
GITHUB_TOKEN=github_pat_xxx npx -y push-signed-commits@v1.0.2 -m $'commit message subject\n\ncommit message body' username/repo master
```

#### Create and push all commits on the current branch since the last pull

```yaml
- uses: pgaskin/push-signed-commits@v1.0.2
  with:
    revision: HEAD@{u}..HEAD
```

```bash
GITHUB_TOKEN=github_pat_xxx npx -y push-signed-commits@v1.0.2 username/repo master HEAD@{u}..HEAD
```

#### Create and push all commits on the current branch since the last pull, then fetch the created commits

```yaml
- uses: pgaskin/push-signed-commits@v1.0.2
  with:
    revision: HEAD@{u}..HEAD
  id: push
- run: git fetch @{u} && git reset --soft ${{ steps.push.outputs.pushed-oid }}
  if: steps.push.outputs.commit-oid != ''
```

#### Push a single commit to a specific branch on another repository as a GitHub App

The app must have `contents:write` permission. The private key can be base64-encoded or newline-escaped.

```yaml
- uses: pgaskin/push-signed-commits@v1.0.2
  with:
    path: other-repo
    repository: username/other-repo
    branch: master
    revision: HEAD
    app-id: 1234
    app-key: ${{ secrets.app_private_key }}
```

```bash
# with a github app installation token (cli)
APP_PRIVATE_KEY="$(< private.pem)" npx -y push-signed-commits@v1.0.2 -C other-repo --app 1234 username/other-repo master HEAD
```

#### Library

```javascript
import { NotPushableError, staged, commits, createCommitOnBranch, createCommitOnBranchInput } from './index.ts'

const url = process.env['GITHUB_GRAPHQL_URL'] ?? 'https://api.github.com/graphql'
const token = process.env['GITHUB_TOKEN'] ?? ''
const git = 'git'
const path = '.'
const repo = 'username/repo'
const branch = 'master'

if (!token) {
  throw new Error('Token is required')
}

try {
  for await (const c of await commits(git, path, 'HEAD@{u}..HEAD')) {
    console.log(`pushing commit ${c.oid}`)
    await createCommitOnBranch(url, token, {
      branch: {
        branchName: branch,
        repositoryNameWithOwner: repo,
      },
      ...await createCommitOnBranchInput(git, path, c),
    })
  }

  const c = await staged(git, path, 'new commit')
  if (c.changes.length) {
    console.log('pushing staged changes')
    await createCommitOnBranch(url, token, {
      branch: {
        branchName: branch,
        repositoryNameWithOwner: repo,
      },
      ...await createCommitOnBranchInput(git, path, c),
    })
  }
} catch (err) {
  if (err instanceof NotPushableError) {
    // ... do something
  }
  throw err
}
```

### Compatibility

This action follows semantic versioning. Release tags are immutable. You can pin it to an exact tag since a working version should continue to work for as long as the node version is supported, as it uses core git functionality and the GitHub API is unlikely to change.

The library also follows semantic versioning, but only the default exports in `index.ts` are covered.

See [CONTRIBUTING](./CONTRIBUTING.md#versioning) for more information.

### Security

There are no external dependencies and release tags are immutable.

Tokens are never printed to the output, even if verbose/debug mode is enabled.

If an app installation token is created, it is automatically revoked before the command exits.

### Alternatives

I made this since the other ones weren't good enough, but here's a list of them anyways:

- [planetscale/ghcommit](https://github.com/planetscale/ghcommit): go, doesn't use git, need to pass all changes as command-line arguments
- [pirafrank/github-commit-sign](https://github.com/pirafrank/github-commit-sign): javascript, doesn't use git, need to pass all changes as command-line arguments
- [verified-bot-commit](https://github.com/IAreKyleW00t/verified-bot-commit): javascript, more complex, doesn't handle some edge cases, uses the old github rest git database api
- [Asana/push-signed-commits](https://github.com/Asana/push-signed-commits): python, much more complex, doesn't handle some edge cases
- [grafana/github-api-commit-action](https://github.com/grafana/github-api-commit-action): bash, creates the commit manually instead of taking an existing one, uses the working directory, doesn't handle most edge cases
- [step-security/github-api-commit-action](https://github.com/step-security/github-api-commit-action): copy of grafana/github-api-commit-action
- [github/gh-aw push_signed_commits](https://github.com/github/gh-aw/blob/48d4b85d8bceb6aaa346ad415ef4a7128c42078b/actions/setup/js/push_signed_commits.cjs): doesn't handle some edge cases, vibe-coded, very [buggy](https://github.com/github/gh-aw/issues/26156).
- [changesets/ghcommit](https://github.com/changesets/ghcommit): typescript, uses the working directory, doesn't handle most edge cases

As of 2026-04-05, most of them don't support pushing a range of existing commits, most of them use the working copy instead of the repository index, most of the git-based ones can't handle filenames with special characters, and none of them verify that all files in the commit can actually be represented properly with the API.
