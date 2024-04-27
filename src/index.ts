import { Octokit } from '@octokit/action'
import * as github from '@actions/github'
import * as core from '@actions/core'
import { getInputs } from './inputs.js'

const octokit = new Octokit()

async function run() {
  const inputs = getInputs()
  if (!inputs)
    return

  if (inputs.actions.upload)
    console.log('Validating', inputs.upload)
}

run()
