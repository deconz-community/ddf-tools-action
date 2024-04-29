// import { Octokit } from '@octokit/action'
import * as core from '@actions/core'
import type { Bundle } from '@deconz-community/ddf-bundler'
import { getParams } from './src/input.js'
import { getSources } from './src/source.js'
import type { MemoryBundle } from './src/bundler.js'
import { runBundler } from './src/bundler.js'
import { runUploader } from './src/uploader.js'
import { handleError, logsErrors } from './src/errors.js'

// const octokit = new Octokit()

async function run() {
  const params = await getParams()
  if (!params)
    return

  core.startGroup(`Current mode : ${params.mode}`)
  const cloneParam = structuredClone(params)
  if (cloneParam.bundler.enabled)
    cloneParam.bundler.signKeys = Array(cloneParam.bundler.signKeys.length).fill('***')

  if (cloneParam.upload.enabled) {
    cloneParam.upload.url = '***'
    cloneParam.upload.token = '***'
  }
  core.info(JSON.stringify(cloneParam, null, 2))
  core.endGroup()

  const sources = await getSources(params)
  const memoryBundles: MemoryBundle[] = []

  if (params.bundler.enabled)
    memoryBundles.push(...await runBundler(params, sources))

  if (params.upload.enabled)
    await runUploader(params, memoryBundles)
}

try {
  run()
}
catch (error) {
  logsErrors(handleError(error))
}
