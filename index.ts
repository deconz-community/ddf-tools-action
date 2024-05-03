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
import { updateClosedPRInteraction, updateModifiedBundleInteraction } from './src/interaction.js'

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

  if (core.isDebug()) {
    core.startGroup('Debug context')
    core.info(JSON.stringify(context, null, 2))
    core.endGroup()
  }

  if (params.mode === 'push')
    await runPush(params)
  else if (params.mode === 'pull_request')
    await runPullRequest(params)
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

async function runPullRequest(params: InputsParams) {
  core.info('Running CI/PR mode')
  const context = github.context

  if (context.eventName !== 'pull_request')
    throw new Error('This action is not supposed to run on pull_request event')

  const payload = context.payload as PullRequestEvent

  core.info(`Current action = ${payload.action}`)

  const sources = await getSources(params, context)
  const bundler = await runBundler(params, sources)
  if (payload.action === 'closed') {
    await updateClosedPRInteraction(params, context, sources, bundler)
  }
  else {
    const uploader = await runUploaders(params, bundler)
    await updateModifiedBundleInteraction(params, context, sources, bundler, uploader)
  }
}
