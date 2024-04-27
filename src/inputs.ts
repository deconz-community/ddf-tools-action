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
  const mode = getInput('mode') as Mode | undefined
  if (!mode)
    throw core.setFailed('Mode must be provided')

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
  const devices = getInput('source-devices-path')
  if (!devices)
    throw core.setFailed('Devices path must be provided')

  let generic = getInput('source-generic-path')

  if (!generic)
    generic = `${devices}/generic`

  const search = getInput('source-search-pattern')
  if (!search)
    throw core.setFailed('Search pattern must be provided')

  return {
    path: {
      devices,
      generic,
    },
    pattern: {
      search,
      ignore: getInput('source-ignore-pattern'),
    },
  }
}
// #endregion

// #region Bundler
const FILE_MODIFIED_METHODS = ['gitlog', 'mtime', 'ctime'] as const
type FileModifiedMethod = typeof FILE_MODIFIED_METHODS[number]

export type BundlerInputs = {
  enabled: true
  outputPath?: string
  signKeys: string[]
  fileModifiedMethod: FileModifiedMethod
  validation: BundlerValidationInputs
} | {
  enabled: false
}

function getBundlerInputs(): BundlerInputs {
  const enabled = getBooleanInput('bundler-enabled')

  if (!enabled)
    return { enabled: false }

  const fileModifiedMethod = getInput('bundle-file-modified-method') as FileModifiedMethod

  if (!FILE_MODIFIED_METHODS.includes(fileModifiedMethod))
    throw core.setFailed(`Unknown file modified method : ${fileModifiedMethod}`)

  // TODO : Check if signKeys are valid
  const signKeys = getArrayInput('bundle-sign-keys')

  return {
    enabled,
    outputPath: getInput('bundler-output-path'),
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
  const enabled = getBooleanInput('bundler-validation-enabled')

  if (!enabled)
    return { enabled: false }

  return {
    enabled,
    strict: getBooleanInput('bundler-validation-strict'),
  }
}
// #endregion

// #region Upload
export type UploadInputs = {
  enabled: true
  inputPath?: string
  url: string
  token: string
} | {
  enabled: false
}

function getUploadInputs(): UploadInputs {
  const enabled = getBooleanInput('upload-enabled')

  if (!enabled)
    return { enabled: false }

  const url = getInput('upload-url')
  const token = getInput('upload-token')

  if (!url || !token)
    throw core.setFailed('Both url and token must be provided for upload action')

  return {
    enabled,
    inputPath: getInput('upload-input-path'),
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
// #endregion

// #region Utils
function getInput(name: string): string | undefined {
  const value = core.getInput(name)
  if (value.length === 0)
    return undefined
  return value
}

function getBooleanInput(name: string): boolean {
  return core.getBooleanInput(name)
}

function getArrayInput(name: string): string[] {
  const data = getInput(name)
  if (!data)
    return []
  return data.split(',')
}

export function assertInputs(params: InputsParams) {
  if (params.upload.enabled && (!params.upload.url || !params.upload.token))
    throw core.setFailed('Both url and token must be provided for upload action')

  if (params.mode === 'ci') {
    if (!params.bundler?.enabled)
      throw core.setFailed('Bundler must be enabled in CI mode')
    if (!params.validation?.enabled)
      throw core.setFailed('Validator must be enabled in CI mode')
  }
}
// #endregion
