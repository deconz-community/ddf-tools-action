import * as core from '@actions/core'

interface CommonInputs {
  source: SourceInputs
  bundler: BundlerInputs
  validation: BundlerValidationInputs
  upload: UploadInputs
}
export type InputsParams = CommonInputs & ({
  mode: 'action'
} | {
  mode: 'ci'
  ci: CIInputs
})

export function getInputs(): InputsParams {
  const params: Partial<InputsParams> = {
    mode: getMode(),
    source: getSourceInputs(),
    bundler: getBundlerInputs(),
    upload: getUploadInputs(),
  }

  if (params.mode === 'ci')
    params.ci = getCIInputs()

  assertInputs(params as InputsParams)

  return params as InputsParams
}

// #region Mode
const MODES = ['action', 'ci'] as const
export type Mode = typeof MODES[number]
function getMode(): Mode {
  const mode = core.getInput('mode') as Mode

  if (!MODES.includes(mode))
    throw core.setFailed(`Unknown mode : ${mode}`)
  else
    core.debug(`Mode : ${mode}`)

  return mode
}
// #endregion

// #region Source
export interface SourceInputs {
  path: {
    devices: string
    generic: string
  }
  pattern: {
    search: string
    ignore?: string
  }
}

function getSourceInputs(): SourceInputs {
  const devices = core.getInput('source-devices-path')
  let generic = core.getInput('source-generic-path')

  if (generic.length === 0)
    generic = `${devices}/generic`

  const search = core.getInput('source-search-pattern')
  const ignore = core.getInput('source-ignore-pattern')
  return {
    path: {
      devices,
      generic,
    },
    pattern: {
      search,
      ignore: ignore.length === 0 ? undefined : ignore,
    },
  }
}
// #endregion

// #region Bundler
const FILE_MODIFIED_METHODS = ['gitlog', 'mtime', 'ctime'] as const
type FileModifiedMethod = typeof FILE_MODIFIED_METHODS[number]

export type BundlerInputs = {
  enabled: true
  path: {
    output: string
  }
  signKeys: string[]
  fileModifiedMethod: FileModifiedMethod
  validation: BundlerValidationInputs
} | {
  enabled: false
}

function getBundlerInputs(): BundlerInputs {
  const enabled = core.getBooleanInput('bundler-enabled')

  if (!enabled)
    return { enabled: false }

  const fileModifiedMethod = core.getInput('bundle-file-modified-method') as FileModifiedMethod

  if (!FILE_MODIFIED_METHODS.includes(fileModifiedMethod))
    throw core.setFailed(`Unknown file modified method : ${fileModifiedMethod}`)

  const signKeys = core.getInput('bundle-sign-keys').length > 0
    ? core.getInput('bundle-sign-keys').split(',')
    : []

  // TODO : Check if signKeys are valid

  return {
    enabled,
    path: {
      output: core.getInput('bundler-output-path'),
    },
    signKeys,
    fileModifiedMethod,
    validation: getValidationInputs(),
  }
}
// #endregion

// #region Bundler Validation
export type BundlerValidationInputs = {
  enabled: true
  strict: boolean
} | {
  enabled: false
}

function getValidationInputs(): BundlerValidationInputs {
  const enabled = core.getBooleanInput('bundler-validation-enabled')

  if (!enabled)
    return { enabled: false }

  return {
    enabled,
    strict: core.getBooleanInput('bundler-validation-strict'),
  }
}
// #endregion

// #region Upload
export type UploadInputs = {
  enabled: true
  path: {
    input: string
  }
  url: string
  token: string
} | {
  enabled: false
}

function getUploadInputs(): UploadInputs {
  const enabled = core.getBooleanInput('upload-enabled')

  if (!enabled)
    return { enabled: false }

  const url = core.getInput('upload-url')
  const token = core.getInput('upload-token')

  if (!url || !token)
    throw core.setFailed('Both url and token must be provided for upload action')

  return {
    enabled,
    path: {
      input: core.getInput('upload-input-path'),
    },
    url,
    token,
  }
}
// #endregion

// #region CI
export type CIInputs = ReturnType<typeof getCIInputs>
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
// #endregion

// #region Utils
export function assertInputs(params: InputsParams) {
  if (params.mode === 'ci') {
    if (!params.bundler?.enabled)
      throw core.setFailed('Bundler must be enabled in CI mode')
    if (!params.validation?.enabled)
      throw core.setFailed('Validator must be enabled in CI mode')
  }
}
// #endregion
