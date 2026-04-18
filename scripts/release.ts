#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const version = process.argv[2]
const versionRe = `v[0-9]+[.][0-9]+[.][0-9]+`
if (!version || !(new RegExp(`^${versionRe}$`)).test(version)) throw new Error(`Version matching ${versionRe} is required`)

const repo = JSON.parse(readFileSync('package.json', 'utf-8')).repository?.url?.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') ?? ''
if (!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) throw new Error(`Failed to extract github repository from package.json`)
console.log(`${repo}@${version}`)

console.log("Updating README")
let readme = readFileSync('README.md', 'utf8')
if (!(new RegExp(`${repo}@v`, 'i')).test(readme)) throw new Error(`No version references found in README`)
readme = readme.replace(new RegExp(`(${repo}@)${versionRe}`, 'gi'), `$1${version}`)
readme = readme.replace(new RegExp(`(${repo}@)v[0-9]+(?![.][0-9])`, 'gi'), `$1${version.split('.')[0]}`)
writeFileSync('README.md', readme)

console.log("Updating package.json version")
let pkg = readFileSync('package.json', 'utf-8')
pkg = pkg.split('\n').map(x => x.includes('"version"') ? x.replace(new RegExp(versionRe.slice(1)), version.slice(1)) : x).join('\n')
writeFileSync('package.json', pkg)

console.log("Updating package-lock.json metadata")
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], { stdio: 'inherit' })
