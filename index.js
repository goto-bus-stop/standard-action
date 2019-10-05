const fetch = require('node-fetch')
const { promisify } = require('util')
const { CLIEngine } = require('eslint')
const actions = require('@actions/core')
const resolve = require('resolve')

const {
  GITHUB_ACTION,
  GITHUB_REPOSITORY,
  GITHUB_SHA,
  GITHUB_TOKEN,
  GITHUB_WORKSPACE
} = process.env

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
    name: GITHUB_ACTION,
    head_sha: GITHUB_SHA,
    status: 'completed',
    started_at: new Date(),
    conclusion: results.errorCount > 0 ? 'failure' : 'success',
    output: {
      title: GITHUB_ACTION,
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

async function main () {
  const formatStyle = actions.getInput('formatter')
  const linterName = actions.getInput('linter')
  const linterPath = resolve.sync(linterName, { basedir: process.cwd() })
  const linter = require(linterPath)
  if (!linter.lintFiles) {
    actions.setFailed(`Module '${linterName}' is not a standard-compatible linter.`)
    process.exit(1)
  }

  const lintFiles = promisify(linter.lintFiles.bind(linter))
  const results = await lintFiles(['index.js'])

  printResults(results, formatStyle)

  try {
    await publishResults(results)
  } catch (err) {
    console.error(err)
    actions.setFailed(err.message)
  }

  if (results.errorCount > 0) {
    actions.setFailed(`${results.errorCount} error(s), ${results.warningCount} warning(s) found`)
    process.exit(1)
  }
}
