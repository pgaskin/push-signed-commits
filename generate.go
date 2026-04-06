//go:build gen

package main

import (
	"bytes"
	"fmt"
	"os"
	"regexp"
)

func init() {
	gen = generate
}

func generate() error {
	if err := replaceFileRegexp("README.md", `@v[0-9]+\.[0-9]+\.[0-9]+`, "@"+DefaultVersion); err != nil {
		return err
	}
	if err := replaceFileBetweenLines("README.md", "<!--CommandUsage-->", "<!---->", "\n```\n"+Config.CommandUsage("")+"```\n\n"); err != nil {
		return err
	}
	if err := replaceFileBetweenLines("README.md", "<!--ActionExample-->", "<!---->", "\n```yaml\n"+Config.ActionExample()+"```\n\n"); err != nil {
		return err
	}
	if err := replaceFileBetweenLines("action.yml", "inputs:", "", Config.ActionInputs()); err != nil {
		return err
	}
	return nil
}

func replaceFileRegexp(name, find, replace string) error {
	re, err := regexp.Compile(find)
	if err != nil {
		return err
	}
	buf, err := os.ReadFile(name)
	if err != nil {
		return err
	}
	return os.WriteFile(name, re.ReplaceAll(buf, []byte(replace)), 644)
}

func replaceFileBetweenLines(name, from, to, repl string) error {
	buf, err := os.ReadFile(name)
	if err != nil {
		return err
	}
	var (
		in   bool
		nbuf []byte
	)
	for len(buf) != 0 {
		i := bytes.IndexByte(buf, '\n')
		if i == -1 {
			break
		}
		if in {
			if string(buf[:i]) == to {
				nbuf = append(nbuf, buf...)
				return os.WriteFile(name, nbuf, 644)
			}
		} else {
			nbuf = append(nbuf, buf[:i+1]...)
			if string(buf[:i]) == from {
				in = true
				nbuf = append(nbuf, repl...)
			}
		}
		buf = buf[i+1:]
	}
	if in {
		return fmt.Errorf("couldn't find %q in %q", from, name)
	}
	return fmt.Errorf("couldn't find %q after %q in %q", to, from, name)
}
