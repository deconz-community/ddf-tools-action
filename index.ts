// import { Octokit } from '@octokit/action'
import * as core from '@actions/core'
import { getInputs } from './src/inputs.js'
import { getSources } from './src/source.js'

// const octokit = new Octokit()

async function run() {
  const inputs = await getInputs()
  if (!inputs)
    return

  const sources = await getSources(inputs)

  sources.getDDFPaths().forEach(async (ddfPath) => {
    core.debug(`Found DDF ${ddfPath}`)
  })
}

run()
