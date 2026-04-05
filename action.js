/*
Here's a bit about how I designed this action.

Actions are typically written in js using github.com/actions/javascript-action.
This template is pretty heavy and opinionated, includes dependencies, has a lot
of inherent churn, and is frankly overkill for what we need.

I considered rewriting this in js (I even wrote an initial draft of it and it's
not too bad: https://gist.github.com/pgaskin/9733ad30d8588f95a9043f75de13b2f7),
but I like Go and using it brings other advantages like being able to `go run`
it anywhere with a Go toolchain installed and better supply-chain security with
defense-in-depth via immutable tags, proxy.golang.org, and sum.golang.org. The
Go toolchain also tends to have better backwards/forwards compatibility than
node.js, so we can avoid the update churn which affects other actions. The
little functionality we would use from @actions/core is well-defined and can
easily be implemented directly (annotations, inputs, simple outputs).

This leads us to the question of the best way to package the action. Go builds
quickly, does not depend on system toolchains if CGO_ENABLED=0, and we do not
have any non-stdlib dependencies, so building it on-the-fly is feasible.

The most common way this is solved is by building a docker container with the
action then calling it. This is simple, but has a number of downsides including:

- It is not currently supported on macOS.
- Since the docker image/version needs to be in the action.yml of the tagged
  release, we cannot pin it to a hash, and it complicates releasing. Other
  actions usually accept this trade-off at the risk of supply-chain attacks on
  the docker registry, or build the release binaries separately from the action
  so it can be pinned in the tag.
- It does not have access to stuff installed on the runner, which matters to us
  since we'd prefer to use the native git installation.
- It's quite overkill for a simple tool like this.
- Images need to be built for all platforms.
- New releases need to be made to get stdlib updates (which also comes with
  losing support for platforms with some major Go versions).

Another common way is to upload pre-built binaries as release assets, then
having the action reference its own repo to download the release binary. This is
a bit nicer for simple tools, but still has significant downsides:

- Less transparency of the binary origin, though this can be mitigated by
  building in GitHub Actions and using attestation.
- Binaries need to be built for all platforms.
- New releases need to be made to get stdlib updates (which also comes with
  losing support for platforms with some major Go versions).
- Still vulnerable to supply-chain attacks unless release immutability is
  enabled, or the binary is pinned with a hash (though the latter has the same
  chicken-and-egg problem as pinning docker images).

A variant of that is to put the binaries in the repo itself, but now you also
get repo bloat.

Another common option is to use a composite action to call @actions/setup-go
then build and run the binary on-the-fly, but with that:

- You need to release updates to keep up with churn in @actions/setup-go.
- You have side-effects which will affect users who have Go projects and also
  use @actions/setup-go.
- This is just dirty.

I spent a bit of time thinking about another approach. Since we support a wide
range of Go versions and can easily be `go run`, is there a way to take
advantage of pre-installed Go versions in both hosted and self-hosted runners?
That would get us automatic stdlib updates, automatic platform support, and
would eliminate the need to build and distribute binaries.

The @actions/setup-go (and other @actions/setup-*) have worked the same way for
many years. To set up Go, it first checks the hosted tool cache (specified via
an env var) for a subdirectory named after the version containing an extracted
Go toolchain. If it doesn't exist, it attempts to download it from the custom
packages in github.com/actions/go-versions, then falls back to go.dev/dl.

All official runner images (github.com/actions/runner-images) have the last few
Go versions pre-cached. For self-hosted ones, I think it's reasonable to expect
a system Go installation if the user wanted it. Thus, we don't need to worry
about selecting, downloading, and unpacking a toolchain.

Due to the Go compatibility promise, we can just use the latest 1.x toolchain.

As such, we only need to concern ourselves with locating the latest Go
toolchain. We don't want to give precedence to the PATH since the user may have
set up an older one for use in their own project (we should still provide a way
to override our selection with a custom toolchain path, though). To enumerate
the usable Go versions, we just need to run go version on the go binary in the
PATH (if any), and all
`{$AGENT_TOOLSDIRECTORY,$RUNNER_TOOL_CACHE}/go/1.X.Y/{x32,x64,arm}` (see
https://github.com/actions/setup-go/blob/main/src/system.ts, installer.ts). We
should also set GOTOOLCHAIN=local to avoid any surprises.

If the tool cache structure changes, it requires updating actions and releasing
a new major version anyways (whether we use @actions/tool-cache or
@actions/setup-go), so we don't lose anything with regards to compatibility by
implementing the search ourselves.

If not found on self-hosted runners (RUNNER_ENVIRONMENT != github-hosted &&
AGENT_ISSELFHOSTED == null || AGENT_ISSELFHOSTED == 1), we can detect that and
ask the user to install it.

Once we have the toolchain, we just need to `go build` and run ourself (and
remember to account for the platform-dependent GOEXE suffix).

The code to do this should be pretty simple so we don't need worry too much
about the node version and can just use the runner default. However, action.yml
currently requires it, so we'll need to set it for now.

For versioning, I could add moving major version tags, but I think I'd rather
ask people to pin it since it gives me more flexibility, this action won't need
regular updates (a working version should continue to work), and it's more
secure anyways.

This keeps our repo clean, simple, and secure, while ensuring broad platform
support.
*/