# push-signed-commits

Tool to push a range of commits via the API so they get signed by GitHub.

### Features

- Uses git to do the diffing natively (unlike a few of the similar alternatives).
- Much more error checking and validation than other similar tools.
- Will refuse to push commits which can't be fully represented via the API, including ones with:
  - Symlink update/creation.
  - Submodule update/creation.
  - Non-regular (i.e., executable) file update/creation.
- Validates the parent commit while pushing.
- Properly escapes all input and filenames.
- Supports empty commits.
- No dependencies other than git.
- Minimal implementation.

### Limitations

- Does not support creating new branches; target branches must already exist.
- Does not support pushing commits with multiple parents (i.e., merge commits) due to API limitations.
- Does not support pushing commits containing changes to non-regular files due to API limitations. 
- Extremely large commits may fail due to size restrictions in the API.
- Subject to the GraphQL API rate limit (unlike regular push operations).
- The author will be replaced with the name/email associated with the token's owner.
- The committer will be replaced with the web flow one (`GitHub <noreply@github.com>`).
- The commit hash will change (obviously).
- The local repository will not be automatically updated to the newly created commits.
