import path from 'node:path'
import * as github from '@actions/github'
import * as core from '@actions/core'
import type { PullRequestEvent } from '@octokit/webhooks-types'
import type { InputsParams } from './src/input.js'
import { getParams, logsParams } from './src/input.js'
import { getSources } from './src/source.js'
import { runBundler } from './src/bundler.js'
import { runUploaders } from './src/uploader.js'
import { handleError, logsErrors } from './src/errors.js'
import { updateClosedPRInteraction, updateModifiedBundleInteraction } from './src/interaction.js'
import { autoCommitUuid } from './src/auto.js'

try {
  run()
}
catch (error) {
  core.setFailed('An error occurred while running the action.')
  logsErrors(path.resolve(), handleError(error))
}

async function run() {
  const context = github.context
  const params = await getParams(context)

  logsParams(params)

  if (core.isDebug()) {
    core.startGroup('Debug context')
    core.debug(JSON.stringify(context, null, 2))
    core.endGroup()
  }

  switch (params.mode) {
    case 'manual':
      return await runManual(params)
    case 'push':
      return await runPush(params)
    case 'pull_request':
      return await runPullRequest(params)
  }
}

async function runManual(params: InputsParams) {
  const context = github.context
  const sources = await getSources(params, context)

  if (params.ci.autoCommitUuid) {
    try {
      await autoCommitUuid(params, sources)
    }
    catch (error) {
      logsErrors(path.resolve(), handleError(error))
      core.setFailed('An error occurred while auto-commiting UUID')
      return
    }
  }

  const bundlerResult = params.bundler.enabled
    ? await runBundler(params, sources)
    : { memoryBundles: [], diskBundles: [], validationErrors: [] }
  if (params.upload.artifact.enabled || params.upload.store.enabled)
    await runUploaders(params, context, bundlerResult)
}

async function runPush(params: InputsParams) {
  const context = github.context
  const sources = await getSources(params, context)

  if (params.ci.autoCommitUuid) {
    try {
      await autoCommitUuid(params, sources)
    }
    catch (error) {
      logsErrors(path.resolve(), handleError(error))
      core.setFailed('An error occurred while auto-commiting UUID')
      return
    }
  }

  const bundlerResult = params.bundler.enabled
    ? await runBundler(params, sources)
    : { memoryBundles: [], diskBundles: [], validationErrors: [] }

  if (params.upload.artifact.enabled || params.upload.store.enabled)
    await runUploaders(params, context, bundlerResult)

  await updateClosedPRInteraction(params, context, sources, bundlerResult)
}

async function runPullRequest(params: InputsParams) {
  const context = github.context

  if (context.eventName !== 'pull_request')
    throw new Error('This action is supposed to run on pull_request event')

  const payload = context.payload as PullRequestEvent
  core.info(`Running Pull Request mode / ${payload.action}`)

  const sources = await getSources(params, context)

  const bundler = await runBundler(params, sources)

  if (bundler.memoryBundles.filter(bundle => bundle.status !== 'unchanged').length === 0) {
    core.info('No bundles changed stopping the action')
    return
  }

  if (['opened', 'reopened', 'synchronize'].includes(payload.action)) {
    const uploader = await runUploaders(params, context, bundler)
    await updateModifiedBundleInteraction(params, context, sources, bundler, uploader)
  }
}
