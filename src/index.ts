import { Octokit } from '@octokit/action'
import * as github from '@actions/github'
import * as core from '@actions/core'
import { getInputs } from './inputs.js'
import { validate } from './validating.js'

const octokit = new Octokit()

async function run() {
  const inputs = getInputs()
  if (!inputs)
    return

  if (inputs.actions.validate === true) {
    const validationResult = await validate(inputs)
    if (validationResult === false)
      core.setFailed('Validation failed')
  }

  if (inputs.actions.upload === true) {
    console.log('Validating', inputs.actions.upload)
    console.log('Validating', inputs.upload)
  }
  else {
    console.log('Validating', inputs.actions.upload)
    console.log('Validating', inputs.upload)
  }
}

run()
