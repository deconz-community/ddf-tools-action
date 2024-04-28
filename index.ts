// import { Octokit } from '@octokit/action'
import * as core from '@actions/core'
import { getParams } from './src/input.js'
import { getSources } from './src/source.js'
import { runBundler } from './src/bundler.js'

// const octokit = new Octokit()

async function run() {
  const params = await getParams()
  if (!params)
    return

  core.startGroup(`Current mode : ${params.mode}`)
  core.info(JSON.stringify(params, null, 2))
  core.endGroup()

  const sources = await getSources(params)

  if (params.bundler.enabled) {
    core.info('Bundler is enabled')
    const bundles = await runBundler(params, sources)

    bundles.forEach((bundle) => {
      core.info(`Bundle ${bundle.data.desc} created`)
    })
  }
}

run()
