import path from 'node:path'
import fs from 'node:fs/promises'
import * as core from '@actions/core'
import { hexToBytes } from '@noble/hashes/utils'

export interface InputsParams {
  mode: 'push' | 'manual' | 'pull_request'
  source: SourceInputs
  bundler: BundlerInputs
  validation: BundlerValidationInputs
  upload: UploadInputs
}

export async function getParams(): Promise<InputsParams> {
  const params: Partial<InputsParams> = {
    mode: getMode(),
    source: await getSourceInputs(),
    bundler: await getBundlerInputs(),
    upload: await getUploadInputs(),
  }

  assertInputs(params as InputsParams)

  return params as InputsParams
}

export function logsParams(params: InputsParams) {
  core.startGroup(`Current mode : ${params.mode}`)
  const cloneParam = structuredClone(params)
  if (cloneParam.bundler.enabled)
    cloneParam.bundler.signKeys = Array(cloneParam.bundler.signKeys.length).fill('***')

  if (cloneParam.upload.store.enabled) {
    cloneParam.upload.store.url = '***'
    cloneParam.upload.store.token = '***'
  }
  core.info(JSON.stringify(cloneParam, null, 2))
  core.endGroup()
}

// #region Mode
const MODES = ['manual', 'push', 'pull_request'] as const
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
const OUTPUT_DIRECTORY_FORMATS = ['source-tree', 'flat'] as const
type OutputDirectoryFormat = typeof OUTPUT_DIRECTORY_FORMATS[number]
const OUTPUT_FILE_FORMATS = ['name', 'hash', 'name-hash'] as const
type OutputFileFormat = typeof OUTPUT_FILE_FORMATS[number]

export type BundlerInputs = {
  enabled: true
  outputPath?: string
  outputDirectoryFormat: OutputDirectoryFormat
  outputFileFormat: OutputFileFormat
  signKeys: Uint8Array[]
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

  const outputDirectoryFormat = getInput('bundler-output-directory-format') as OutputDirectoryFormat
  if (!OUTPUT_DIRECTORY_FORMATS.includes(outputDirectoryFormat))
    throw core.setFailed(`Unknown output directory format : ${outputDirectoryFormat}`)

  const outputFileFormat = getInput('bundler-output-file-format') as OutputFileFormat
  if (!OUTPUT_FILE_FORMATS.includes(outputFileFormat))
    throw core.setFailed(`Unknown output file format : ${outputFileFormat}`)

  if (outputFileFormat === 'name' && outputDirectoryFormat === 'flat')
    throw core.setFailed('Output file format "name" is not compatible with output directory format "flat" because multiple files can have the same path.')

  // TODO : Check if signKeys are valid
  const signKeys = getArrayInput('bundler-sign-keys').map(hexToBytes)

  const outputPath = (await getDirectoryInput('bundler-output-path', true, true))
    ?? await fs.mkdtemp('ddf-bundler')

  return {
    enabled,
    outputPath,
    outputDirectoryFormat,
    outputFileFormat,
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
  warnUnusedFiles: boolean
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
    warnUnusedFiles: getBooleanInput('bundler-validation-warn-unused-files'),
  }
}
// #endregion

// #region Upload
export const STORE_BUNDLE_STATUSES = ['alpha', 'beta', 'stable'] as const
export type StoreBundleStatus = typeof STORE_BUNDLE_STATUSES[number]
export interface UploadInputs {
  store: {
    enabled: true
    inputPath?: string
    url: string
    token: string
    status: StoreBundleStatus
    toolboxUrl?: string
  } | {
    enabled: false
    toolboxUrl?: string
  }
  artifact: {
    enabled: true
    filter?: string[]
    retentionDays: number
  } | {
    enabled: false
  }
}

async function getUploadInputs(): Promise<UploadInputs> {
  return {
    store: await (async () => {
      if (!getBooleanInput('upload-store-enabled')) {
        return {
          enabled: false,
          toolboxUrl: getInput('upload-store-toolbox-url'),
        }
      }

      const url = getInput('upload-store-url')
      const token = getInput('upload-store-token')

      if (!url || !token)
        throw core.setFailed('Both url and token must be provided for upload action')

      const status = getInput('upload-store-status')

      if (status && !STORE_BUNDLE_STATUSES.includes(status as StoreBundleStatus))
        throw core.setFailed(`Unknown store status : ${status}`)

      return {
        enabled: true,
        inputPath: await getDirectoryInput('upload-store-input-path', true),
        url,
        token,
        status: (status ?? STORE_BUNDLE_STATUSES[0]) as StoreBundleStatus,
        toolboxUrl: getInput('upload-store-toolbox-url'),
      }
    })(),
    artifact: (() => {
      if (!getBooleanInput('upload-artifact-enabled'))
        return { enabled: false }

      return {
        enabled: true,
        filter: getInput('upload-artifact-filter')?.split(','),
        retentionDays: Number.parseInt(getInput('upload-artifact-retention-days') ?? '3'),
      }
    })(),
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
  if (params.mode === 'pull_request') {
    if (!params.bundler?.enabled)
      throw core.setFailed('Bundler must be enabled in CI mode')
    if (!params.bundler.validation?.enabled)
      throw core.setFailed('Validator must be enabled in CI mode')
  }
}
// #endregion
