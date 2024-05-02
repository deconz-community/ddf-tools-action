import * as github from '@actions/github'
import * as core from '@actions/core'
import { Octokit } from '@octokit/action'
import type { PullRequestEvent } from '@octokit/webhooks-types'
import type { InputsParams } from './src/input.js'
import { getParams, logsParams } from './src/input.js'
import { getSources } from './src/source.js'
import type { MemoryBundle } from './src/bundler.js'
import { runBundler } from './src/bundler.js'
import { runUploader } from './src/uploader.js'
import { handleError, logsErrors } from './src/errors.js'
import { updateModifiedBundleInteraction } from './src/interaction.js'

try {
  run()
}
catch (error) {
  logsErrors(handleError(error))
}

async function run() {
  const params = await getParams()
  logsParams(params)

  if (params.mode === 'action')
    await runAction(params)
  else if (params.mode === 'ci-pr')
    await runCIPR(params)
}

async function runAction(params: InputsParams) {
  const context = github.context
  const sources = await getSources(params, context)
  const memoryBundles: MemoryBundle[] = []
  if (params.bundler.enabled)
    memoryBundles.push(...await runBundler(params, sources))
  if (params.upload.enabled)
    await runUploader(params, memoryBundles)
}

async function runCIPR(params: InputsParams) {
  core.info('Running CI/PR mode')
  const context = github.context

  if (context.eventName !== 'pull_request')
    throw new Error('This action is not supposed to run on pull_request event')

  const octokit = new Octokit()

  const payload = context.payload as PullRequestEvent

  core.info(`Current action = ${payload.action}`)

  const sources = await getSources(params, context)

  const memoryBundles = await runBundler(params, sources)

  memoryBundles.forEach((memoryBundle) => {
    core.info(`Bundle ${memoryBundle.path} is ${memoryBundle.status}`)
  })

  if (params.upload.enabled)
    await runUploader(params, memoryBundles)

  await updateModifiedBundleInteraction(params, context, memoryBundles)

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
