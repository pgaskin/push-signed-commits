//go:build gha

package main

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"reflect"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"unicode"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "\x1b[0;31merror: %v\x1b[0m\n", err) // red
		os.Exit(1)
	}
}

func run() error {
	var (
		opt    Options
		repo   string
		branch string
	)

	tlsConfig := http.DefaultTransport.(*http.Transport).TLSClientConfig
	if tlsConfig == nil {
		tlsConfig = new(tls.Config)
	}

	if v := getInput("path", true); v != "" {
		if err := os.Chdir(v); err != nil {
			return err
		}
	}

	if v := getInput("repository", true); v != "" {
		repo = v
	} else {
		return fmt.Errorf("input 'repository' must not be empty")
	}

	if v := getInput("branch", true); v != "" {
		branch = v
	} else if strings.HasPrefix(v, "refs/tags/") {
		return fmt.Errorf("input 'branch' must not be a tag")
	} else {
		return fmt.Errorf("input 'branch' must not be empty")
	}

	if v := getInput("revision", true); v != "" {
		opt.Revision = v
	} else {
		opt.Commit = true
	}

	if v := getInput("allow-empty", true); v != "" {
		v, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("input 'allow-empty' must be a valid bool")
		}
		opt.CommitAllowEmpty = v
	}

	if v := getInput("commit-message", true); v != "" {
		opt.CommitMessage = v
	}

	if v := getInput("user-agent", true); v != "" {
		UserAgent = v
	}

	if v := getInput("insecure-skip-verify", true); v != "" {
		v, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("input 'allow-empty' must be a valid bool")
		}
		tlsConfig.InsecureSkipVerify = v
	}

	if v := getInput("dry-run", true); v != "" {
		v, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("input 'dry-run' must be a valid bool")
		}
		opt.DryRun = v
	}

	if v := getInput("github-token", true); v != "" {
		opt.Token = GitHubToken(v)
	}

	if v := getInput("github-api-url", true); v != "" {
		opt.GitHubAPI = GitHubAPI(v)
	} else if v := os.Getenv("GITHUB_API_URL"); v != "" {
		opt.GitHubAPI = GitHubAPI(v)
	} else {
		opt.GitHubAPI = DefaultGitHubAPI
	}

	if v := getInput("github-graphql-url", true); v != "" {
		opt.GitHubGraphQL = GitHubGraphQL(v)
	} else if v := os.Getenv("GITHUB_GRAPHQL_URL"); v != "" {
		opt.GitHubGraphQL = GitHubGraphQL(v)
	} else {
		opt.GitHubGraphQL = DefaultGitHubGraphQL
	}

	if v := getInput("app-id", true); v != "" {
		v, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return fmt.Errorf("input 'app-id' must be a valid int64")
		}
		opt.App = v
	}

	if v := getInput("app-key", true); v != "" {
		opt.AppKey = v
	}

	if v := getInput("git-binary", true); v != "" {
		opt.Git = Git(v)
	}

	warning = func(format string, a ...any) {
		fmt.Fprintf(os.Stderr, "\x1b[0;33mwarning: "+format+"\x1b[0m\n", a...) // yellow
	}

	status = func(format string, a ...any) {
		fmt.Fprintf(os.Stderr, "\x1b[0;32m"+format+"\x1b[0m\n", a...) // green
	}

	verbose = func(format string, a ...any) {
		if isDebug {
			fmt.Fprintf(os.Stderr, "\x1b[0;2m"+format+"\x1b[0m\n", a...) // faint
		}
	}

	debugcmd = func(cmd string, args ...string) {
		if isDebug {
			fmt.Fprintf(os.Stderr, "\x1b[0;34m%s%s\x1b[0m\n", cmd, fmtargs(args...)) // blue
		}
	}

	var (
		commitOIDs       []string
		commitOID        string
		sourceCommitOIDs []string
		sourceCommitOID  string
	)

	opt.OnDryRunCommit = func(localCommit OID, input CreateCommitOnBranchInput, inputJSON []byte) {
		if localCommit != "" {
			sourceCommitOIDs = append(sourceCommitOIDs, string(localCommit))
			sourceCommitOID = string(localCommit)
		}
		var desc string
		if localCommit != "" {
			desc = "commit " + string(localCommit)
		} else {
			desc = "new commit"
		}
		status("would push %s (%d bytes)", desc, len(inputJSON))
		for _, line := range strings.Split(input.Message.Headline, "\n") {
			status("  > %s", line)
		}
		if input.Message.Body != "" {
			status("  >")
			for _, line := range strings.Split(input.Message.Body, "\n") {
				status("  > %s", line)
			}
		}
		for _, f := range input.FileChanges.Additions {
			status("  + %s (%d bytes)", string(appendMaybeQuoteToASCII(nil, f.Path)), len(f.Contents))
		}
		for _, f := range input.FileChanges.Deletions {
			status("  - %s", string(appendMaybeQuoteToASCII(nil, f.Path)))
		}
	}

	opt.OnPushedNewCommit = func(newCommit OID) {
		commitOIDs = append(commitOIDs, string(newCommit))
		commitOID = string(newCommit)
	}

	opt.OnPushedExistingCommit = func(localCommit, newCommit OID) {
		sourceCommitOIDs = append(sourceCommitOIDs, string(localCommit))
		sourceCommitOID = string(localCommit)
		commitOIDs = append(commitOIDs, string(newCommit))
		commitOID = string(newCommit)
	}

	err := Run(repo, branch, opt)
	setOutput("not-pushable", err != nil && errors.As(err, new(*NotPushableError)))
	if !opt.DryRun {
		setOutput("commit-oids", strings.Join(commitOIDs, " "))
		setOutput("commit-oid", string(commitOID))
	}
	if !opt.Commit {
		setOutput("src-commit-oids", strings.Join(sourceCommitOIDs, " "))
		setOutput("src-commit-oid", string(sourceCommitOID))
	}
	return err
}

// actions/core@v3.0.0/src/core.ts
var isDebug = os.Getenv("RUNNER_DEBUG") == "1"

// actions/core@v3.0.0/src/core.ts
func getInput(name string, trim bool) string {
	v := os.Getenv("INPUT_" + strings.Map(func(r rune) rune {
		if r == ' ' {
			return '_'
		}
		return unicode.ToUpper(r)
	}, name))
	if trim {
		v = strings.TrimSpace(v)
	}
	return v
}

// actions/core@v3.0.0/src/core.ts
func setOutput(name string, value any) {
	if p := os.Getenv("GITHUB_OUTPUT"); p != "" {
		issueFileCommand("OUTPUT", prepareKeyValueMessage(name, value))
		return
	}
	if _, err := os.Stdout.WriteString(eol()); err != nil {
		panic(err)
	}
	issueCommand("set-output", map[string]string{"name": name}, toCommandValue(value))
}

// actions/core@v3.0.0/src/utils.ts
func toCommandValue(input any) string {
	if input == nil {
		return ""
	}
	if v := reflect.ValueOf(input); v.Kind() == reflect.String {
		return v.String()
	}
	if j, err := json.Marshal(input); err != nil {
		panic(err)
	} else {
		return string(j)
	}
}

// actions/core@v3.0.0/src/file-command.ts
func issueFileCommand(command string, message any) {
	path := os.Getenv("GITHUB_" + command)
	if path == "" {
		panic("unable to find environment variable for file command " + command)
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		panic("unable to append to file command file: " + err.Error())
	}
	defer f.Close()

	if _, err := f.WriteString(toCommandValue(message) + eol()); err != nil {
		panic("unable to append to file command file: " + err.Error())
	}
	if err := f.Close(); err != nil {
		panic("unable to append to file command file: " + err.Error())
	}
}

// actions/core@v3.0.0/src/file-command.ts
func prepareKeyValueMessage(key string, value any) string {
	delimiter := "ghadelimiter_" + uuid()
	convertedValue := toCommandValue(value)
	if strings.Contains(key, delimiter) {
		panic("wtf: name should not contain the delimiter")
	}
	if strings.Contains(convertedValue, delimiter) {
		panic("wtf: value should not contain the delimiter")
	}
	return key + "<<" + delimiter + eol() + convertedValue + eol() + delimiter
}

// actions/core@v3.0.0/src/command.ts
func issueCommand(command string, properties map[string]string, message string) {
	var b strings.Builder
	b.WriteString("::")
	b.WriteString(command)
	if properties != nil {
		var ks []string
		for k := range properties {
			ks = append(ks, k)
		}
		slices.Sort(ks)
		for i, k := range ks {
			if i == 0 {
				b.WriteByte(',')
			} else {
				b.WriteByte(' ')
			}
			b.WriteString(k)
			b.WriteByte('=')
			for _, c := range properties[k] {
				switch c {
				case '%':
					b.WriteString("%25")
				case '\r':
					b.WriteString("%0D")
				case '\n':
					b.WriteString("%0A")
				case ':':
					b.WriteString("%3A")
				case ',':
					b.WriteString("%2C")
				default:
					b.WriteRune(c)
				}
			}
		}
	}
	b.WriteString("::")
	for _, c := range message {
		switch c {
		case '%':
			b.WriteString("%25")
		case '\r':
			b.WriteString("%0D")
		case '\n':
			b.WriteString("%0A")
		default:
			b.WriteRune(c)
		}
	}
	b.WriteString(eol())
	if _, err := os.Stdout.WriteString(b.String()); err != nil {
		panic(err)
	}
}

// nodejs/node@v24.0.0/lib/os.js EOL
func eol() string {
	switch runtime.GOOS {
	case "windows":
		return "\r\n"
	default:
		return "\n"
	}
}

func uuid() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant bits
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
