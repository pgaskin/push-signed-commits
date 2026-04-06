package main

import (
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
)

var (
	warning  = func(format string, a ...any) {}
	status   = func(format string, a ...any) {}
	verbose  = func(format string, a ...any) {}
	debugcmd = func(cmd string, args ...string) {}
)

var version string

var UserAgent = func() string {
	var ua strings.Builder

	ua.WriteString("push-signed-commits")
	if version != "none" {
		ua.WriteByte('/')
		if version != "" {
			ua.WriteString(version)
		} else {
			if info, ok := debug.ReadBuildInfo(); ok && strings.HasPrefix(info.Main.Version, "v") {
				ua.WriteString(info.Main.Version[1:])
			} else {
				ua.WriteString("devel")
			}
		}
	}
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Path != "" {
		ua.WriteString(" (")
		ua.WriteString(runtime.Version())
		ua.WriteString("; ")
		ua.WriteString(runtime.GOOS)
		ua.WriteString("/")
		ua.WriteString(runtime.GOARCH)
		ua.WriteString("; ")
		ua.WriteString(info.Main.Path)
		if info.Main.Sum != "" {
			ua.WriteString(" ")
			ua.WriteString(info.Main.Sum)
		}
		ua.WriteString(")")
	}

	if ci, _ := strconv.ParseBool(os.Getenv("CI")); ci && os.Getenv("GITHUB_ACTION") != "" {
		ua.WriteString(" github-actions (")
		ua.WriteString(os.Getenv("GITHUB_REPOSITORY"))
		if v := os.Getenv("GITHUB_RUN_ID"); v != "" {
			ua.WriteString("; run-id=")
			ua.WriteString(v)
		}
		if v := os.Getenv("GITHUB_ACTOR_ID"); v != "" {
			ua.WriteString("; actor-id=")
			ua.WriteString(v)
		}
		if v := os.Getenv("RUNNER_ENVIRONMENT"); v != "" {
			ua.WriteString("; runner-environment=")
			ua.WriteString(v)
		}
		ua.WriteString(")")
	}

	return ua.String()
}()
