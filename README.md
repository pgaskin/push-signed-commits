# push-signed-commits

Create verified commits for bots or workflows via the GitHub API.

<!-- TODO: write more tests
 - generate test repos with git fast-import
 - unit tests for git stuff
 - integration tests for change generation
 - e2e tests on a test repo, also testing the cli interface and action inputs, and that the output trees and commit messages match
-->

### Quick Start

##### GitHub Actions

```yaml
# with the github actions token
- uses: pgaskin/push-signed-commits@v0.0.6
  with:
    commit-message: commit message

# with a github app installation token
- uses: pgaskin/push-signed-commits@v0.0.6
  with:
    path: other-repo
    repository: username/other-repo
    branch: master
    commit-message: commit message
```

##### Standalone

```bash
# with a github token
GITHUB_TOKEN=... go run pgaskin/push-signed-commits@v0.0.6 -commit username/repo master 'commit message'

# with a github app installation token
APP_PRIVATE_KEY=... go run pgaskin/push-signed-commits@v0.0.6 -app 1234 -commit username/other-repo master 'commit message'
```

### Features

- Highly flexible commit selection.
  - Supports pushing a single commit.
  - Supports pushing a range of existing commits using git's native revision [syntax](https://git-scm.com/docs/gitrevisions).
  - Supports pushing a new commit from the staging area.
- Guarantees the correctness and fidelity of pushed commits.
  - Supports pushing empty commits.
  - Specifies the expected parent commit while pushing.
  - Preserves multi-line commit message subjects and bodies.
  - Converts non-utf-8 commit messages to utf-8.
  - Refuses to push commits which can't be fully represented via the API, including ones with:
    - Symlink update/creation.
    - Submodule update/creation.
    - Non-regular (i.e., executable) file update/creation.
    - *Note: I've opened a feature request to add support for these types.*
  - Uses git to do the diffing natively and reads directly from the repository rather than the working directory (unlike a few of the similar alternatives).
    - The contents will be correct.
    - The `core.autocrlf` option will be applied consistently (since git does it when adding to the index).
    - Uses plumbing commands (e.g., `diff-tree` vs `diff`) to avoid being affected by the local git config.
    - Supports [unusual](https://git-scm.com/docs/git-config#Documentation/git-config.txt-corequotePath) filenames with special characters (newlines, tabs, quotes, backslashes, non-printable characters, etc) by using null-terminated output.
- High-quality implementation:
  - Much more error checking and validation than other similar tools.
  - Minimal implementation.
  - No dependencies other than the native git command.
  - 100% hand-coded and tested.
- Automatically retries failed API calls.
- Supports automatically creating and revoking an app installation token.

### Limitations

- The [`createCommitOnBranch`](https://docs.github.com/en/graphql/reference/mutations#createcommitonbranch) GraphQL mutation has some limitations:
  - On the commit:
    - Extremely large commits may fail due to size restrictions in the API.
    - The GraphQL API rate limit applies (unlike regular push operations).
    - Does not support creating new branches, the target branch must already exist.
  - On the commit metadata:
    - The author/commit date will be replaced with the current date.
    - The author will be replaced with the name/email associated with the token's owner.
    - The committer will be replaced with the web flow one (currently `GitHub <noreply@github.com>`).
    - The commit hash will change (obviously).
  - On the commit contents:
    - Does not support pushing commits with multiple parents (i.e., merge commits).
    - Does not support pushing commits containing changes to non-regular files (e.g., symlinks, submodules, executables). 
- The local repository will not be automatically updated to the newly created commits (if you want that, fetch then do a `git reset --soft` to the last commit printed).

### Compatibility

You should pin this to an exact version for stability and security. A working version should continue to work indefinitely, as it uses core git functionality and the GitHub API is unlikely to change. For GitHub Actions, you will need to update it occasionally for toolchain updates.

The arguments and output follow semantic versioning.

### Security

There are no external dependencies and release tags are immutable.

Tokens are never printed to the output, even if verbose/debug mode is enabled.

If an app installation token is created, it is automatically revoked before the command exits.

### Usage

##### GitHub Actions

<!--ActionExample-->

```yaml
- uses: github.com/pgaskin/push-signed-commits@v0.0.6
  with:
    # The local repository path relative to the current directory. If you change
    # this, you probably also want to change the `repository` and `branch`.'
    path: ''

    # The target repository username/name if not the same as the workflow. This
    # does not need to match the local repo upstream. If not on the same GitHub
    # server as the workflow, you need to override the $GITHUB_API_URL and
    # $GITHUB_GRAPHQL_URL environment variables.'
    repository: '${{ github.repository }}'

    # The target branch name if not the same as the workflow ref, optionally
    # including the `refs/heads/` prefix. This does not need to match the local
    # repo branch. You cannot push to tags.'
    branch: '${{ github.ref }}'

    # The commit or commit range to push to the remote. If you want to push the
    # last local commit, use `HEAD`. If the local branch has an upstream set,
    # you can use `HEAD@{u}..HEAD` to push all commits added since the last
    # pull. Note that force-pushes are not supported and will be rejected. See
    # https://git-scm.com/docs/gitrevisions. If not set, a new commit will be
    # created from the staging area. If there is nothing to commit or push,
    # nothing will be done and the command will exit successfully.'
    revision: ''

    # Whether to make a new commit from the staging area even if there's nothing
    # to commit. Only used if `revision` is not set.'
    allow-empty: 'false'

    # The commit message to use if creating a new commit from the staging area.'
    commit-message: ''

    # The file to read the commit message from. Overrides `commit-message`.'
    commit-message-file: ''

    # Override the user agent used to make GitHub API requests.'
    user-agent: ''

    # Do not validate SSL certificates when making GitHub API requests.'
    insecure-skip-verify: 'false'

    # Do not push commits, just print the mutations which would be made.'
    dry-run: 'false'

    # The token to use to make GitHub API requests.'
    github-token: '${{ github.token }}'

    # GitHub API URL. If not set, it will be set from $GITHUB_API_URL to be the
    # same as the one where the workflow is running from (e.g.,
    # https://api.github.com or https://my-ghes-server.example.com/api/v3).'
    github-api-url: ''

    # GitHub GraphQL API URL. If not set, it will be set from
    # $GITHUB_GRAPHQL_URL to be the same as the one where the workflow is
    # running from (e.g., https://api.github.com or
    # https://my-ghes-server.example.com/api/graphql).'
    github-graphql-url: ''

    # Authenticate as a GitHub App with the specified ID. The installation ID
    # will be detected based on `repository`. Overrides `github-token`. The app
    # must have the 'contents:write' permission. If you already have an app
    # installation token, you can pass it via `github-token` instead.'
    app-id: ''

    # The private key to use if authenticating as a GitHub App. Can be
    # base64-encoded or contain escaped ('\n') newlines.'
    app-key: ''

    # The git binary to use. If not specified, the one in the PATH is used.'
    git-binary: ''

    # The go binary to use to run the action. If not specified, one is
    # automatically selected from the PATH and the runner tool cache.'
    go-binary: ''
```

<!---->

###### Outputs

- `not-pushable`
  Set to true if one or more commits were not pushed (the oid outputs will
  still be set to the ones pushed so far) since they contained unpushable
  content.

- `commit-oids`
  The new commit hash of all commits pushed, space-separated. On failure, it
  contains the ones pushed so far. Not set if 'dry-run'.

- `commit-oid`
  The new commit hash of the last commit pushed, or an empty string if no
  commits were pushed. On failure, it contains the ones pushed so far. Not
  set if 'dry-run'.

- `src-commit-oids`
  The local commit hashes of all commits pushed corresponding to the ones in
  commit-oids. Not set if creating a new commit from the staging area. Still
  set if 'dry-run'.

- `src-commit-oid`
  The local commit hashes of the last commit pushed corresponding to the
  ones in commit-oids. Not set if creating a new commit from the staging
  area. Still set if 'dry-run'.

##### Standalone

<!--CommandUsage-->

```
usage: go run github.com/pgaskin/push-signed-commits@v0.0.6 [options]

  -C string, --path string
      The local repository path relative to the current directory.

  -r string, --repository string
      The target repository username/name. This does not need to match the local
      repo upstream.

  -b string, --branch string
      The target branch name, optionally including the `refs/heads/` prefix.
      This does not need to match the local repo branch. You cannot push to
      tags.

  -r string, --revision string
      The commit or commit range to push to the remote. If you want to push the
      last local commit, use `HEAD`. If the local branch has an upstream set,
      you can use `HEAD@{u}..HEAD` to push all commits added since the last
      pull. Note that force-pushes are not supported and will be rejected. See
      https://git-scm.com/docs/gitrevisions. If not set, a new commit will be
      created from the staging area. If there is nothing to commit or push,
      nothing will be done and the command will exit successfully.

  --allow-empty
      Whether to make a new commit from the staging area even if there's nothing
      to commit. Only used if --revision is not set.

  -m string, --commit-message string
      The commit message to use if creating a new commit from the staging area.

  -F string, --commit-message-file string
      The file to read the commit message from. Overrides --commit-message.

  --user-agent string
      Override the user agent used to make GitHub API requests.

  -k, --insecure-skip-verify
      Do not validate SSL certificates when making GitHub API requests.

  -n, --dry-run
      Do not push commits, just print the mutations which would be made.

  --github-token string, $GITHUB_TOKEN
      The token to use to make GitHub API requests.

  --github-api-url string, $GITHUB_API_URL
      GitHub API URL.

  --github-graphql-url string, $GITHUB_GRAPHQL_URL
      GitHub GraphQL API URL.

  --app-id int64
      Authenticate as a GitHub App with the specified ID. The installation ID
      will be detected based on --repository. Overrides --github-token. The app
      must have the 'contents:write' permission. If you already have an app
      installation token, you can pass it via --github-token instead.

  --app-key private-key, $APP_PRIVATE_KEY
      The private key to use if authenticating as a GitHub App. Can be
      base64-encoded or contain escaped ('\n') newlines.

  --git-binary string
      The git binary to use. If not specified, the one in the PATH is used.

  -v, --debug
      Show debug output.
```

<!---->

### Examples

##### Create and push a commit if there are staged changes

```bash
export GITHUB_TOKEN=
go run github.com/pgaskin/push-signed-commits@v0.0.6 -commit username/repo master $'commit message subject\n\ncommit message body'
```

```yaml
- uses: pgaskin/push-signed-commits@v0.0.6
  with:
    commit-message: |
      commit message subject

      commit message body
```

##### Create and push all commits on the current branch since the last pull

```bash
export GITHUB_TOKEN=
go run github.com/pgaskin/push-signed-commits@v0.0.6 username/repo 'HEAD@{u}..HEAD'
```

```yaml
- uses: pgaskin/push-signed-commits@v0.0.6
```

##### Create and push all commits on the current branch since the last pull, then fetch the created commits

```yaml
- uses: pgaskin/push-signed-commits@v0.0.6
  id: push
- run: git fetch @{u} && git reset --soft ${{ steps.push.outputs.commit-oid }}
  if: steps.push.outputs.commit-oid != ''
```

##### Push a single commit to a specific branch on another repository as a GitHub App

The app must have `contents:write` permission. The private key can be base64-encoded or newline-escaped.

```bash
export APP_PRIVATE_KEY=
go run github.com/pgaskin/push-signed-commits@v0.0.6 -app 1234 username/other-repo 'HEAD@{u}..HEAD'
```

```yaml
- uses: pgaskin/push-signed-commits@v0.0.6
  with:
    path: other-repo
    repository: username/other-repo
    branch: master
    revision: HEAD
    app-id: 1234
    app-key: ${{ secrets.app_private_key }}
```

### Alternatives

I made this since the other ones weren't good enough, but here's a list of them anyways:

- [planetscale/ghcommit](https://github.com/planetscale/ghcommit): go, doesn't use git, need to pass all changes as command-line arguments
- [pirafrank/github-commit-sign](https://github.com/pirafrank/github-commit-sign): javascript, doesn't use git, need to pass all changes as command-line arguments
- [verified-bot-commit](https://github.com/IAreKyleW00t/verified-bot-commit): javascript, more complex, doesn't handle some edge cases, uses the old github rest git database api
- [Asana/push-signed-commits](https://github.com/Asana/push-signed-commits): python, much more complex, doesn't handle some edge cases
- [grafana/github-api-commit-action](https://github.com/grafana/github-api-commit-action): bash, creates the commit manually instead of taking an existing one, uses the working directory, doesn't handle most edge cases
- [step-security/github-api-commit-action](https://github.com/step-security/github-api-commit-action): copy of grafana/github-api-commit-action
- [github/gh-aw push_signed_commits](https://github.com/github/gh-aw/blob/48d4b85d8bceb6aaa346ad415ef4a7128c42078b/actions/setup/js/push_signed_commits.cjs): doesn't handle some edge cases, vibe-coded, very [buggy](https://github.com/github/gh-aw/pull/21576#pullrequestreview-4058718607).
- [changesets/ghcommit](https://github.com/changesets/ghcommit): typescript, uses the working directory, doesn't handle most edge cases

As of 2026-04-05, most of them don't support pushing a range of existing commits, most of them use the working copy instead of the repository index, most of the git-based ones can't handle filenames with special characters, and none of them verify that all files in the commit can actually be represented properly with the API.
