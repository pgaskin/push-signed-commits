package main

import (
	"crypto/rsa"
	"fmt"
	"os"
)

const DefaultVersion = "v0.0.6" // the version of the most recent tag

var Input struct {
	Path               string          `short.cmd:"C"                                                 doc:"The local repository path relative to the current directory.#{ If you change this, you probably also want to change the #.Repository and #.Branch.#}"`
	Repository         string          `short.cmd:"r" def.gha:"${{ github.repository }}"              doc:"The target repository username/name#{ if not the same as the workflow#}. This does not need to match the local repo upstream.#{ If not on the same GitHub server as the workflow, you need to override the #$GithubApiUrl and #$GithubGraphqlUrl environment variables.#}"`
	Branch             string          `short.cmd:"b" def.gha:"${{ github.ref }}"                     doc:"The target branch name#{ if not the same as the workflow ref#}, optionally including the #'refs/heads/#' prefix. This does not need to match the local repo branch. You cannot push to tags."`
	Revision           string          `short.cmd:"r"                                                 doc:"The commit or commit range to push to the remote. If you want to push the last local commit, use #'HEAD#'. If the local branch has an upstream set, you can use #'HEAD@{u}..HEAD#' to push all commits added since the last pull. Note that force-pushes are not supported and will be rejected. See https://git-scm.com/docs/gitrevisions. If not set, a new commit will be created from the staging area. If there is nothing to commit or push, nothing will be done and the command will exit successfully."`
	AllowEmpty         bool            `                                                              doc:"Whether to make a new commit from the staging area even if there's nothing to commit. Only used if #.Revision is not set."`
	CommitMessage      string          `short.cmd:"m"                                                 doc:"The commit message to use if creating a new commit from the staging area."`
	CommitMessageFile  string          `short.cmd:"F"                                                 doc:"The file to read the commit message from. Overrides #.CommitMessage."`
	UserAgent          string          `                                                              doc:"Override the user agent used to make GitHub API requests."`
	InsecureSkipVerify bool            `short.cmd:"k"                                                 doc:"Do not validate SSL certificates when making GitHub API requests."`
	DryRun             bool            `short.cmd:"n"                                                 doc:"Do not push commits, just print the mutations which would be made."`
	GithubToken        string          `env.cmd:"GITHUB_TOKEN" def.gha:"${{ github.token }}"          doc:"The token to use to make GitHub API requests."`
	GithubApiUrl       GitHubAPI       `env:"GITHUB_API_URL"                                          doc:"GitHub API URL.#{ If not set, it will be set from #$GithubApiUrl to be the same as the one where the workflow is running from (e.g., https://api.github.com or https://my-ghes-server.example.com/api/v3).#}"`
	GithubGraphqlUrl   GitHubGraphQL   `env:"GITHUB_GRAPHQL_URL"                                      doc:"GitHub GraphQL API URL.#{ If not set, it will be set from #$GithubGraphqlUrl to be the same as the one where the workflow is running from (e.g., https://api.github.com or https://my-ghes-server.example.com/api/graphql).#}"`
	AppId              int64           `                                                              doc:"Authenticate as a GitHub App with the specified ID. The installation ID will be detected based on #.Repository. Overrides #.GithubToken. The app must have the 'contents:write' permission. If you already have an app installation token, you can pass it via #.GithubToken instead."`
	AppKey             *rsa.PrivateKey `env.cmd:"APP_PRIVATE_KEY"                                     doc:"The private key to use if authenticating as a GitHub App. Can be base64-encoded or contain escaped ('\\n') newlines."`
	GitBinary          string          `                                                              doc:"The git binary to use. If not specified, the one in the PATH is used."`
	GoBinary           string          `name.cmd:""                                                   doc:"The go binary to use to run the action. If not specified, one is automatically selected from the PATH and the runner tool cache."`
	Debug              bool            `short.cmd:"v" name.gha:"" env.gha:"RUNNER_DEBUG"              doc:"Show debug output."`
}

var gen func() error

func main() {
	if gen != nil {
		if err := gen(); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
		}
		return
	}

}
