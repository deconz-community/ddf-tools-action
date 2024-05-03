import * as github from '@actions/github'
import * as core from '@actions/core'
import { Octokit } from '@octokit/action'
import type { PullRequestEvent } from '@octokit/webhooks-types'
import type { InputsParams } from './src/input.js'
import { getParams, logsParams } from './src/input.js'
import { getSources } from './src/source.js'
import { runBundler } from './src/bundler.js'
import { runUploaders } from './src/uploader.js'
import { handleError, logsErrors } from './src/errors.js'
import { updateModifiedBundleInteraction } from './src/interaction.js'

try {
  run()
}
catch (error) {
  core.setFailed('An error occurred while running the action.')
  logsErrors(handleError(error))
}

async function run() {
  const params = await getParams()
  logsParams(params)

  const context = github.context

  core.info(`context = ${JSON.stringify(context, null, 2)}`)

  if (params.mode === 'push')
    await runPush(params)
  else if (params.mode === 'pull_request')
    await runCIPR(params)
}

async function runPush(params: InputsParams) {
  const context = github.context
  const sources = await getSources(params, context)
  const bundlerResult = params.bundler.enabled
    ? await runBundler(params, sources)
    : { memoryBundles: [], diskBundles: [], validationErrors: [] }

  if (params.upload.artifact.enabled || params.upload.store.enabled)
    await runUploaders(params, bundlerResult)
}

async function runCIPR(params: InputsParams) {
  core.info('Running CI/PR mode')
  const context = github.context

  if (context.eventName !== 'pull_request')
    throw new Error('This action is not supposed to run on pull_request event')

  const payload = context.payload as PullRequestEvent

  core.info(`Current action = ${payload.action}`)

  if (core.isDebug() || true) {
    core.startGroup('Debug payload')
    core.info(JSON.stringify(payload, null, 2))
    core.endGroup()
  }

  const sources = await getSources(params, context)
  const bundler = await runBundler(params, sources)
  const uploader = await runUploaders(params, bundler)

  await updateModifiedBundleInteraction(params, context, sources, bundler, uploader)

  /*
  // List of modified files
  const files = await octokit.rest.pulls.listFiles({
    ...context.repo,
    pull_number: payload.pull_request.number,
  })

  files.data.forEach((file) => {
    core.info(`Modified file: ${file.filename}`)
  })
  */

  /*
  // List of comments
  const comments = await octokit.rest.issues.listComments({
    ...context.repo,
    issue_number: payload.pull_request.number,
  })

  comments.data.forEach((comment) => {
    if (!comment.user || comment.user.login !== 'github-actions[bot]')
      return

    let count = Number(comment.body)
    if (Number.isNaN(count))
      count = 0

    count += 1
    comment.body = count.toString()

    octokit.rest.issues.updateComment({
      ...context.repo,
      comment_id: comment.id,
      body: comment.body,
    })

    core.info(`Comment = ${comment.body}`)
  })

  core.info(`Comment = ${JSON.stringify(comments, null, 2)}`)
  */

  if (core.isDebug()) {
    core.startGroup('Debug context')
    core.debug(JSON.stringify(github.context, null, 2))
    core.endGroup()
  }
}
