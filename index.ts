// import { Octokit } from '@octokit/action'
import * as github from '@actions/github'
import * as core from '@actions/core'
import type { InputsParams } from './src/input.js'
import { getParams, logsParams } from './src/input.js'
import { getSources } from './src/source.js'
import type { MemoryBundle } from './src/bundler.js'
import { runBundler } from './src/bundler.js'
import { runUploader } from './src/uploader.js'
import { handleError, logsErrors } from './src/errors.js'

// const octokit = new Octokit()
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
  const sources = await getSources(params)
  const memoryBundles: MemoryBundle[] = []
  if (params.bundler.enabled)
    memoryBundles.push(...await runBundler(params, sources))
  if (params.upload.enabled)
    await runUploader(params, memoryBundles)
}

async function runCIPR(_params: InputsParams) {
  core.info('Running CI/PR mode')

  core.info(`Current action = ${github.context.payload.action}`)

  core.startGroup('Debug context')
  core.info(JSON.stringify(github.context, null, 2))
  core.endGroup()
}
