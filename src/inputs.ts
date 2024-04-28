import path from 'node:path'
import fs from 'node:fs/promises'
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

export async function getInputs(): Promise<InputsParams> {
  const params: Partial<InputsParams> = {
    mode: getMode(),
    source: await getSourceInputs(),
    bundler: await getBundlerInputs(),
    upload: await getUploadInputs(),
  }

  if (params.mode === 'ci')
    params.ci = getCIInputs()

  assertInputs(params as InputsParams)

  if (core.isDebug()) {
    core.debug(`##[group]Inputs params`)
    core.debug(JSON.stringify(params, null, 2))
    core.debug(`##[endgroup]`)
  }

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

async function getSourceInputs(): Promise<SourceInputs> {
  const devices = await getDirectoryInput('source-devices-path')
  const generic = await getDirectoryInput('source-generic-path', true)
    ?? await getDirectory(`${devices}/generic`, 'source-generic-path')

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

async function getBundlerInputs(): Promise<BundlerInputs> {
  const enabled = getBooleanInput('bundler-enabled')

  if (!enabled)
    return { enabled: false }

  const fileModifiedMethod = getInput('bundler-file-modified-method') as FileModifiedMethod

  if (!FILE_MODIFIED_METHODS.includes(fileModifiedMethod))
    throw core.setFailed(`Unknown file modified method : ${fileModifiedMethod}`)

  // TODO : Check if signKeys are valid
  const signKeys = getArrayInput('bundler-sign-keys')

  const outputPath = await getDirectoryInput('bundler-output-path', true)

  return {
    enabled,
    outputPath,
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
  enforceUUID: boolean
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
    enforceUUID: getBooleanInput('bundler-validation-enforce-uuid'),
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

async function getUploadInputs(): Promise<UploadInputs> {
  const enabled = getBooleanInput('upload-enabled')

  if (!enabled)
    return { enabled: false }

  const url = getInput('upload-url')
  const token = getInput('upload-token')

  if (!url || !token)
    throw core.setFailed('Both url and token must be provided for upload action')

  return {
    enabled,
    inputPath: await getDirectoryInput('upload-input-path'),
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

async function getDirectoryInput<Optional extends boolean = false>(
  name: string,
  optional: Optional = false as Optional,
  autoCreate = false,
): Promise<Optional extends true ? (string | undefined) : string > {
  const inputPath = getInput(name)
  return getDirectory(inputPath, name, optional, autoCreate)
}

export async function getDirectory<Optional extends boolean = false>(
  inputPath: string | undefined,
  name: string,
  optional: Optional = false as Optional,
  autoCreate = false,
): Promise<Optional extends true ? (string | undefined) : string > {
  if (!inputPath) {
    if (optional === true)
      return undefined as any
    throw core.setFailed(`The option '${name}' must be defined`)
  }

  const directoryPath = path.resolve(inputPath)

  try {
    const directoryStat = await fs.stat(directoryPath)
    if (!directoryStat.isDirectory())
      throw core.setFailed(`The option '${name}' must be valid directory path`)
  }
  catch (err) {
    if (autoCreate && typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT')
      await fs.mkdir(directoryPath, { recursive: true })
    else
      throw err
  }

  return directoryPath
}

export function assertInputs(params: InputsParams) {
  if (params.mode === 'ci') {
    if (!params.bundler?.enabled)
      throw core.setFailed('Bundler must be enabled in CI mode')
    if (!params.validation?.enabled)
      throw core.setFailed('Validator must be enabled in CI mode')
  }
}
// #endregion
