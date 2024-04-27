import { debug, getBooleanInput, getInput, setFailed } from '@actions/core'

const ACTIONS = ['validate', 'bundle', 'upload', 'ci'] as const
type Actions = typeof ACTIONS[number]

const FILE_MODIFIED_METHODS = ['gitlog', 'mtime', 'ctime'] as const
type FileModifiedMethod = typeof FILE_MODIFIED_METHODS[number]

export function getInputs() {
  try {
    const actions = getActions()
    return {
      actions,
      source: (actions.includes('validate') || actions.includes('validate')) ? getSourceInputs() : undefined,
      validation: actions.includes('validate') ? getValidationInputs() : undefined,
      bundler: actions.includes('bundle') ? getBundlerInputs() : undefined,
      upload: actions.includes('upload') ? getUploadInputs() : undefined,
      ci: actions.includes('ci') ? getCIInputs() : undefined,
    }
  }
  catch (err) {
    return false
  }
}

function getActions(): Actions[] {
  const ACTIONS = ['validate', 'bundle', 'upload', 'ci'] as const

  const actions = getInput('actions').split(',')

  const unknownActions = actions.filter(action => !ACTIONS.includes(action as Actions))
  if (unknownActions.length > 0)
    throw setFailed(`Unknown action : ${unknownActions.join(',')}`)

  debug(`Actions : ${actions.join(',')}`)

  return actions as Actions[]
}

function getSourceInputs() {
  const devices = getInput('source-devices-path')
  const generic = getInput('source-generic-path')
  const search = getInput('source-search-pattern')
  const ignore = getInput('source-ignore-pattern')
  return {
    path: { devices, generic },
    pattern: { search, ignore },
  }
}

function getValidationInputs() {
  const noSkip = getBooleanInput('validation-no-skip')
  return {
    noSkip,
  }
}

function getBundlerInputs() {
  const fileModifiedMethod = getInput('bundle-file-modified-method')

  if (!FILE_MODIFIED_METHODS.includes(fileModifiedMethod as FileModifiedMethod))
    throw setFailed(`Unknown file modified method : ${fileModifiedMethod}`)

  return {
    path: {
      output: getInput('bundler-output-path'),
    },
    keys: getInput('bundle-sign-keys').split(','),
    fileModifiedMethod,
  }
}

function getUploadInputs() {
  const url = getInput('upload-url')
  const token = getInput('upload-token')

  if (!url || !token)
    throw setFailed('Both url and token must be provided for upload action')

  return {
    path: {
      input: getInput('upload-input-path'),
    },
    url,
    token,
  }
}

function getCIInputs() {
  return {
    pr: {
      validate: getBooleanInput('ci-pr-validate'),
      draftBundle: getBooleanInput('ci-pr-draft-bundle'),
      releaseBundle: getBooleanInput('ci-pr-release-bundle'),
      affectedBundleList: getBooleanInput('ci-pr-affected-bundle-list'),
    },
    push: {
      validate: getBooleanInput('ci-push-validate'),
      upload: getBooleanInput('ci-push-upload'),
    },
  }
}
