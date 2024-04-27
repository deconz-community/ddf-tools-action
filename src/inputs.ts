import { debug, getBooleanInput, getInput, setFailed } from '@actions/core'

const ACTIONS = ['validate', 'bundle', 'upload', 'ci'] as const
type Actions = typeof ACTIONS[number]

const FILE_MODIFIED_METHODS = ['gitlog', 'mtime', 'ctime'] as const
type FileModifiedMethod = typeof FILE_MODIFIED_METHODS[number]

type ActionsType = {
  [K in Actions]: boolean;
}

// TODO Make this types works

type SourceInput = ReturnType<typeof getSourceInputs>
type ValidationInput = ReturnType<typeof getValidationInputs>
type BundlerInput = ReturnType<typeof getBundlerInputs>
type UploadInput = ReturnType<typeof getUploadInputs>
type CIInput = ReturnType<typeof getCIInputs>

/*
export type Inputs = {
  actions: ActionsType
}
// & (ActionsType['validate'] extends true ? { source: SourceInput } : { source: undefined })
// & (ActionsType['bundle'] extends true ? { source: SourceInput } : { source: undefined })
// & (ActionsType['validate'] extends true ? { validation: ValidationInput } : { validation: undefined })
// & (ActionsType['bundle'] extends true ? { bundler: BundlerInput } : { bundler: undefined })
& (ActionsType['upload'] extends true ? { upload: UploadInput } : { upload: undefined })
// & (ActionsType['ci'] extends true ? { ci: CIInput } : { ci: undefined })
*/

type Inputs<Action extends ActionsType> = {
  actions: Action
} // & (T['validate'] extends true ? { source: SourceInput } : { source?: never })
// & (T['bundle'] extends true ? { source: SourceInput } : { source?: never })
// & (T['validate'] extends true ? { validation: ValidationInput } : { validation?: never })
// & (T['bundle'] extends true ? { bundler: BundlerInput } : { bundler?: never })
& (Action['upload'] extends true ? { upload: UploadInput } : { upload?: never })
// & (T['ci'] extends true ? { ci: CIInput } : { ci?: never })

export function getInputs() /* : Inputs<Action> | false */ {
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

function getActions(): ActionsType {
  const ACTIONS = ['validate', 'bundle', 'upload', 'ci'] as const

  const actions = getInput('actions').split(',')

  const unknownActions = actions.filter(action => !ACTIONS.includes(action as Actions))
  if (unknownActions.length > 0)
    throw setFailed(`Unknown action : ${unknownActions.join(',')}`)

  debug(`Actions : ${actions.join(',')}`)

  return ACTIONS.reduce((acc, action) => {
    acc[action] = actions.includes(action)
    return acc
  }, {} as Record<Actions, boolean>)
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
      releaseBundle: getBooleanInput('ci-push-release-bundle'),
    },
  }
}
