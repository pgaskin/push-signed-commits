package main

var (
	warning  = func(format string, a ...any) {}
	status   = func(format string, a ...any) {}
	verbose  = func(format string, a ...any) {}
	debugcmd = func(cmd string, args ...string) {}
)
