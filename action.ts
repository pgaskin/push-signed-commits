import os from 'node:os'

import { Console } from 'node:console'

globalThis.console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  colorMode: true,
})

/**
 * Create an expandable group in the output for the current scope.
 */
function ghaGroup(name: string): Disposable {
  ghaCommand('group', {}, name)
  return {
    [Symbol.dispose]() {
      ghaCommand('endgroup', {}, '')
    }
  }
}

/**
 * Emits a command for GitHub Actions.
 *
 * Based on logic in:
 * - actions/core@v3.0.0/src/command.ts
 * - https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
 */
function ghaCommand(command: string, properties: {[key: string]: any}, message: string) {
  let props = ''
  if (properties) {
    for (const [key, val] of Object.entries(properties)) {
      if (val) {
        if (props) {
          props += ','
        } else {
          props += ' '
        }
        props += `${key}=${val.toString().replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C')}`
      }
    }
  }
  process.stdout.write(`::${command}${props}::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}${os.EOL}`)
}

/**
 * Get an action input.
 *
 * Based on logic in:
 * - actions/core@v3.0.0/src/core.ts
 */
function getInput(name: string, trim: boolean = false): string {
  const val: string = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || ''
  return trim ? val.trim() : val
}

/**
 * Whether we're in debug mode.
 *
 * Based on logic in:
 * - actions/core@v3.0.0/src/core.ts
 */
const DEBUG = process.env['RUNNER_DEBUG'] === '1'

/**
 * Whether the runner is self-hosted.
 *
 * Based on logic in:
 * - actions/setup-go@v6.4.0/src/utils.ts
 */
const SELFHOSTED = process.env['RUNNER_ENVIRONMENT'] !== 'github-hosted' && (process.env['AGENT_ISSELFHOSTED'] === '1' || process.env['AGENT_ISSELFHOSTED'] === undefined)
