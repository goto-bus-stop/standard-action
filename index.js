const fetch = require('node-fetch')
const { promisify } = require('util')
const { CLIEngine } = require('eslint')
const actions = require('@actions/core')
const resolve = require('resolve')

const {
  GITHUB_REPOSITORY,
  GITHUB_SHA,
  GITHUB_TOKEN,
  GITHUB_WORKSPACE
} = process.env

const CHECK_NAME = 'Standard'

main().catch((err) => {
  actions.setFailed(err.message)
  process.exit(1)
})

async function publishResults (results) {
  const annotations = []

  for (const result of results.results) {
    annotations.push(...toAnnotations(result))
  }

  const headers = {
    'content-type': 'application/json',
    accept: 'application/vnd.github.antiope-preview+json',
    authorization: `Bearer ${GITHUB_TOKEN}`,
    'user-agent': 'standard-action'
  }

  const check = {
    name: CHECK_NAME,
    head_sha: GITHUB_SHA,
    status: 'completed',
    started_at: new Date(),
    conclusion: results.errorCount > 0 ? 'failure' : 'success',
    output: {
      title: CHECK_NAME,
      summary: `${results.errorCount} error(s), ${results.warningCount} warning(s) found`,
      annotations
    }
  }

  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/check-runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(check)
  })

  if (response.status !== 201) {
    // eh
    const err = await response.json()
    throw err
  }

  function toAnnotations ({ filePath, messages }) {
    const path = filePath.substr(GITHUB_WORKSPACE.length + 1)
    return messages.map(({ line, severity, ruleId, message }) => {
      const annotationLevel = {
        1: 'warning',
        2: 'failure'
      }[severity]
      return {
        path,
        start_line: line,
        end_line: line,
        annotation_level: annotationLevel,
        message: `[${ruleId}] ${message}`
      }
    })
  }
}

function printResults (results, formatStyle) {
  const formatter = CLIEngine.getFormatter(formatStyle)
  console.log(formatter(results.results, {}))
}

function loadLinter (name) {
  let linterPath
  try {
    linterPath = resolve.sync(name, { basedir: process.cwd() })
  } catch (err) {
    if (name === 'standard') {
      linterPath = 'standard' // use our bundled standard version
    } else {
      throw new Error(`Linter '${name}' not found, perhaps you need a 'run: npm install' step before this one?`)
    }
  }

  let linter
  try {
    linter = require(linterPath)
  } catch (err) {
    throw new Error(`Linter '${name}' not found, perhaps you need a 'run: npm install' step before this one?`)
  }

  if (!linter.lintFiles) {
    throw new Error(`Module '${name}' is not a standard-compatible linter.`)
  }

  return linter
}

async function main () {
  const formatStyle = actions.getInput('formatter')
  const linterName = actions.getInput('linter')
  const useAnnotations = actions.getInput('annotate')
  if (useAnnotations === true && !process.env.GITHUB_TOKEN) {
    throw new Error(`when using annotate: true, you must set

    env:
      GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}

in your action config.`)
  }

  const linter = loadLinter(linterName)

  const lintFiles = promisify(linter.lintFiles.bind(linter))
  const results = await lintFiles(['index.js'])

  printResults(results, formatStyle)

  if (useAnnotations) {
    try {
      await publishResults(results)
    } catch (err) {
      console.error(err)
      actions.setFailed(err.message)
    }
  }

  if (results.errorCount > 0) {
    actions.setFailed(`${results.errorCount} error(s), ${results.warningCount} warning(s) found`)
    process.exit(1)
  }
}
