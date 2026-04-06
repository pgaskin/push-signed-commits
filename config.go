package main

import (
	"crypto/rsa"
	"fmt"
	"reflect"
	"strings"
	"unicode"
)

//go:generate go run -tags gen .

type ConfigFields []ConfigField

type ConfigField struct {
	Name, Def, Env struct {
		Cmd string
		Act string
	}
	Short struct {
		Cmd string
	}
	Doc struct {
		Raw string
		Cmd string
		Act string
	}
	Bool  bool
	Field reflect.StructField
	Value reflect.Value
}

var Config = func() ConfigFields {
	defer func() {
		if err := recover(); err != nil {
			panic(fmt.Sprintf("init config: %v", err))
		}
	}()

	cv := reflect.ValueOf(&Input).Elem()
	ct := cv.Type()
	cf := make([]ConfigField, ct.NumField())
	cm := make(map[string]*ConfigField, ct.NumField())

	// get the fields
	for fi := range cf {
		fc := &cf[fi]
		fv := cv.Field(fi)
		ft := ct.Field(fi)

		fc.Bool = ft.Type.Kind() == reflect.Bool
		fc.Field = ft
		fc.Value = fv

		cm[ft.Name] = fc
	}

	// parse the struct tags
	for fi := range cf {
		fc := &cf[fi]

		// flag/input name
		if v, ok := fc.Field.Tag.Lookup("name"); ok {
			fc.Name.Cmd = v
			fc.Name.Act = v
		} else {
			var b strings.Builder
			for i, c := range fc.Field.Name {
				if unicode.IsUpper(c) {
					if i != 0 {
						b.WriteByte('-')
					}
					b.WriteRune(unicode.ToLower(c))
				} else {
					b.WriteRune(c)
				}
			}
			fc.Name.Cmd = b.String()
			fc.Name.Act = b.String()
		}
		if v, ok := fc.Field.Tag.Lookup("name.cmd"); ok {
			fc.Name.Cmd = v
		}
		if v, ok := fc.Field.Tag.Lookup("name.gha"); ok {
			fc.Name.Act = v
		}

		// env var
		if v, ok := fc.Field.Tag.Lookup("env"); ok {
			fc.Env.Cmd = v
			fc.Env.Act = v
		}
		if v, ok := fc.Field.Tag.Lookup("env.cmd"); ok {
			fc.Env.Cmd = v
		}
		if v, ok := fc.Field.Tag.Lookup("env.gha"); ok {
			fc.Env.Act = v
		}

		// default value
		if v, ok := fc.Field.Tag.Lookup("def"); ok {
			fc.Def.Cmd = v
			fc.Def.Act = v
		}
		if v, ok := fc.Field.Tag.Lookup("def.cmd"); ok {
			fc.Def.Cmd = v
		}
		if v, ok := fc.Field.Tag.Lookup("def.gha"); ok {
			fc.Def.Act = v
		}
		if fc.Bool {
			if fc.Def.Cmd != "" || fc.Def.Act != "" {
				panic(fc.Field.Name + ": bool field must not have explicit default")
			}
			fc.Def.Act = "false"
		}

		// short name
		if v, ok := fc.Field.Tag.Lookup("short.cmd"); ok {
			fc.Short.Cmd = v
		}

		// doc template
		if v, ok := fc.Field.Tag.Lookup("doc"); ok {
			fc.Doc.Raw = v
		}
	}

	// parse the doc templates
	for fi := range cf {
		fc := &cf[fi]

		var cmd, gha strings.Builder
		var nocmd, nogha bool
		for doc := fc.Doc.Raw; len(doc) != 0; {
			if doc[0] != '#' {
				i := strings.IndexByte(doc, '#')
				if i == -1 {
					i = len(doc)
				}
				if !nocmd {
					cmd.WriteString(doc[:i])
				}
				if !nogha {
					gha.WriteString(doc[:i])
				}
				doc = doc[i:]
			}
			if len(doc) == 0 {
				break
			}
			if len(doc) == 1 {
				panic(fc.Field.Name + ": eof after doc esc")
			}

			// escaped #
			if doc[1] == '#' {
				if !nocmd {
					cmd.WriteByte('#')
				}
				if !nogha {
					gha.WriteByte('#')
				}
				doc = doc[2:]
				continue
			}

			// escaped `
			if doc[1] == '\'' {
				if !nocmd {
					cmd.WriteByte('`')
				}
				if !nogha {
					gha.WriteByte('`')
				}
				doc = doc[2:]
				continue
			}

			// actions-only doc fragment
			if doc[1] == '{' {
				nocmd = true
				doc = doc[2:]
				continue
			}

			// end actions-only doc fragment
			if doc[1] == '}' {
				nocmd = false
				doc = doc[2:]
				continue
			}

			// local-only doc fragment
			if doc[1] == '[' {
				nogha = true
				doc = doc[2:]
				continue
			}

			// end local-only doc fragment
			if doc[1] == '}' {
				nogha = false
				doc = doc[2:]
				continue
			}

			// field name/env ref
			if doc[1] == '.' || doc[1] == '$' {
				i := 2
			ref:
				for ; i < len(doc); i++ {
					switch {
					case 'A' <= doc[i] && doc[i] <= 'Z':
					case 'a' <= doc[i] && doc[i] <= 'z' && i > 2:
					case '0' <= doc[i] && doc[i] <= '9' && i > 2:
					default:
						break ref
					}
				}

				ref, ok := cm[doc[2:i]]
				if !ok {
					panic(fc.Field.Name + ": undefined ref to " + doc[2:i])
				}
				switch doc[1] {
				case '.':
					if !nocmd {
						cmd.WriteByte('-')
						cmd.WriteByte('-')
						cmd.WriteString(ref.Name.Cmd)
					}
					if !nogha {
						gha.WriteByte('`')
						gha.WriteString(ref.Name.Act)
						gha.WriteByte('`')
					}
				case '$':
					if !nocmd {
						cmd.WriteByte('$')
						cmd.WriteString(ref.Env.Cmd)
					}
					if !nogha {
						gha.WriteByte('$')
						gha.WriteString(ref.Env.Act)
					}
				default:
					panic("wtf")
				}
				doc = doc[i:]
				continue
			}

			panic(fc.Field.Name + ": invalid escape " + string(doc[1]))
		}
		if nocmd {
			panic(fc.Field.Name + ": eof in actions-only doc frag")
		}
		fc.Doc.Cmd = cmd.String()
		fc.Doc.Act = gha.String()
	}

	return cf
}()

func (c ConfigFields) ParseActions() error {

}

func (c ConfigFields) ParseCommand() error {

}

func (c ConfigField) ArgTypeDesc() string {
	if c.Bool {
		return ""
	}
	switch c.Value.Interface().(type) {
	case *rsa.PrivateKey:
		return "private-key"
	}
	return c.Field.Type.Kind().String()
}

func (c ConfigFields) CommandUsage(arg0 string) string {
	var b strings.Builder
	b.WriteString("usage: ")
	if arg0 != "" {
		b.WriteString(arg0)
	} else {
		b.WriteString("go run github.com/pgaskin/push-signed-commits@")
		b.WriteString(DefaultVersion)
	}
	b.WriteString(" [options]\n\n")
	var first bool
	for _, fc := range Config {
		if fc.Name.Cmd == "" {
			continue
		}
		if !first {
			first = true
		} else {
			b.WriteString("\n")
		}
		b.WriteString("  ")
		if fc.Short.Cmd != "" {
			b.WriteString("-")
			b.WriteString(fc.Short.Cmd)
			if t := fc.ArgTypeDesc(); t != "" {
				b.WriteString(" ")
				b.WriteString(t)
			}
			b.WriteString(", ")
		}
		b.WriteString("--")
		b.WriteString(fc.Name.Cmd)
		if t := fc.ArgTypeDesc(); t != "" {
			b.WriteString(" ")
			b.WriteString(t)
		}
		if fc.Env.Cmd != "" {
			b.WriteString(", $")
			b.WriteString(fc.Env.Cmd)
		}
		if fc.Def.Cmd != "" {
			b.WriteString(" (default ")
			b.Write(appendMaybeQuoteToASCII(nil, fc.Def.Cmd))
			b.WriteString(")")
		}
		b.WriteString("\n")
		wrapText(&b, "      ", fc.Doc.Cmd, 80-6)
		b.WriteString("\n")
	}
	return b.String()
}

func (c ConfigFields) ActionExample() string {
	var b strings.Builder
	b.WriteString("- uses: github.com/pgaskin/push-signed-commits@")
	b.WriteString(DefaultVersion)
	b.WriteString("\n")
	b.WriteString("  with:\n")
	var first bool
	for _, fc := range Config {
		if fc.Name.Act == "" {
			continue
		}
		if !first {
			first = true
		} else {
			b.WriteString("\n")
		}
		wrapText(&b, "    # ", fc.Doc.Act, 80-6)
		b.WriteString("'\n")
		b.WriteString("    ")
		b.WriteString(fc.Name.Act)
		b.WriteString(": '")
		b.WriteString(fc.Def.Act)
		b.WriteString("'\n")
	}
	return b.String()
}

func (c ConfigFields) ActionInputs() string {
	var b strings.Builder
	for _, fc := range Config {
		if fc.Name.Act == "" {
			continue
		}
		b.WriteString("  ")
		b.WriteString(fc.Name.Act)
		b.WriteString(":\n")
		b.WriteString("    description:\n")
		wrapText(&b, "      ", fc.Doc.Act, 80-6)
		b.WriteString("\n")
		if fc.Def.Act != "" {
			b.WriteString("    default: '")
			b.WriteString(fc.Def.Act)
			b.WriteString("'\n")
		}
	}
	return b.String()
}

func wrapText(b *strings.Builder, prefix, text string, cols int) {
	var col int
	for i := 0; i < len(text); {
		// newlines
		if text[i] == '\n' {
			b.WriteByte('\n')
			b.WriteByte('\n')
			i++
			continue
		}

		// find the next word
		start := i
		for i < len(text) && text[i] != ' ' {
			i++
		}
		word := text[start:i]

		// skip spaces until the next word
		for i < len(text) && text[i] == ' ' {
			i++
		}

		// add the previous space and the word
		if col == 0 {
			b.WriteString(prefix)
			b.WriteString(word)
			col = len(word)
		} else if col+1+len(word) <= cols {
			b.WriteByte(' ')
			b.WriteString(word)
			col += 1 + len(word)
		} else {
			b.WriteByte('\n')
			b.WriteString(prefix)
			b.WriteString(word)
			col = len(word)
		}
	}
}
