import * as core from '@actions/core'

export type InputsParams = Exclude<ReturnType<typeof getInputs>, false>

export function getInputs() {
  try {
    const actions = getActions()
    return {
      actions,
      source: (actions.validate || actions.bundle) ? getSourceInputs() : undefined,
      validation: actions.validate ? getValidationInputs() : undefined,
      bundler: actions.bundle ? getBundlerInputs() : undefined,
      upload: actions.upload ? getUploadInputs() : undefined,
      ci: actions.ci ? getCIInputs() : undefined,
    }
  }
  catch (err) {
    return false
  }
}

function getActions() {
  const ACTIONS = ['validate', 'bundle', 'upload', 'ci'] as const
  type Actions = typeof ACTIONS[number]

  const actions = core.getInput('actions').split(',')

  const unknownActions = actions.filter(action => !ACTIONS.includes(action as Actions))
  if (unknownActions.length > 0)
    throw core.setFailed(`Unknown action : ${unknownActions.join(',')}`)

  core.debug(`Actions : ${actions.join(',')}`)

  return ACTIONS.reduce((acc, action) => {
    acc[action] = actions.includes(action)
    return acc
  }, {} as Record<Actions, boolean>)
}

function getSourceInputs() {
  const devices = core.getInput('source-devices-path')
  let generic = core.getInput('source-generic-path')

  if (generic.length === 0)
    generic = `${devices}/generic`

  const search = core.getInput('source-search-pattern')
  const ignore = core.getInput('source-ignore-pattern')
  return {
    path: { devices, generic },
    pattern: { search, ignore },
  }
}

function getValidationInputs() {
  const noSkip = core.getBooleanInput('validation-no-skip')
  return {
    noSkip,
  }
}

function getBundlerInputs() {
  const FILE_MODIFIED_METHODS = ['gitlog', 'mtime', 'ctime'] as const
  type FileModifiedMethod = typeof FILE_MODIFIED_METHODS[number]

  const fileModifiedMethod = core.getInput('bundle-file-modified-method')

  if (!FILE_MODIFIED_METHODS.includes(fileModifiedMethod as FileModifiedMethod))
    throw core.setFailed(`Unknown file modified method : ${fileModifiedMethod}`)

  return {
    path: {
      output: core.getInput('bundler-output-path'),
    },
    keys: core.getInput('bundle-sign-keys').split(','),
    fileModifiedMethod,
  }
}

function getUploadInputs() {
  const url = core.getInput('upload-url')
  const token = core.getInput('upload-token')

  if (!url || !token)
    throw core.setFailed('Both url and token must be provided for upload action')

  return {
    path: {
      input: core.getInput('upload-input-path'),
    },
    url,
    token,
  }
}

function getCIInputs() {
  return {
    pr: {
      validate: core.getBooleanInput('ci-pr-validate'),
      draftBundle: core.getBooleanInput('ci-pr-draft-bundle'),
      releaseBundle: core.getBooleanInput('ci-pr-release-bundle'),
      affectedBundleList: core.getBooleanInput('ci-pr-affected-bundle-list'),
    },
    push: {
      validate: core.getBooleanInput('ci-push-validate'),
      releaseBundle: core.getBooleanInput('ci-push-release-bundle'),
    },
  }
}
