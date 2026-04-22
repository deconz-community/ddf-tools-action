import type { Bundle, ValidationError } from '@deconz-community/ddf-bundler'
import type { FileDefinitionWithError } from '@deconz-community/ddf-validator'
import type { InputsParams } from './input'
import type { FileStatus, Sources } from './source'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as core from '@actions/core'
import { buildFromFiles, createSignature, encode, generateHash } from '@deconz-community/ddf-bundler'
import { createValidator } from '@deconz-community/ddf-validator'
import { bytesToHex } from '@noble/hashes/utils.js'
import { getPublicKey } from '@noble/secp256k1'
import { handleError, logsErrors } from './errors'

const BUNDLER_CONCURRENCY = 8

type ParsedValidationFile = {
  path: string
  data: Record<string, unknown>
}

type GlobalValidationState = {
  errorsByPath: Map<string, ValidationError[]>
  skippedDDFPaths: Set<string>
  version: string
}

async function parseValidationFile(sources: Sources, filePath: string): Promise<ParsedValidationFile | FileDefinitionWithError> {
  const source = await sources.getSource(filePath, false)
  const rawData = await source.stringData

  try {
    const data = JSON.parse(rawData)

    if (typeof data !== 'object' || data === null) {
      return {
        error: new Error('Something went wrong while parsing the DDF file'),
        path: filePath,
        data,
      }
    }

    return {
      path: filePath,
      data,
    }
  }
  catch (error) {
    return {
      error: error as Error,
      path: filePath,
      data: null,
    }
  }
}

async function createGlobalValidationState(params: InputsParams, sources: Sources, validationErrors: ValidationError[]): Promise<GlobalValidationState> {
  const { bundler } = params

  const validator = createValidator()
  const errorsByPath: Map<string, ValidationError[]> = new Map()
  const skippedDDFPaths: Set<string> = new Set()
  const validationResult: FileDefinitionWithError[] = []

  core.info('Pre-validating source files')

  const genericFiles = await Promise.all(sources.getGenericPaths().map(filePath => parseValidationFile(sources, filePath)))
  const ddfFiles = await Promise.all(sources.getDDFPaths().map(filePath => parseValidationFile(sources, filePath)))

  const parsedGenericFiles: ParsedValidationFile[] = []
  genericFiles.forEach((file) => {
    if ('error' in file)
      validationResult.push(file)
    else
      parsedGenericFiles.push(file)
  })

  const parsedDDFFiles: ParsedValidationFile[] = []
  ddfFiles.forEach((file) => {
    if ('error' in file) {
      validationResult.push(file)
      return
    }

    if (bundler.enabled && bundler.validation.enabled){
      if (file.data.ddfvalidate === false && !bundler.validation.strict) {
        skippedDDFPaths.add(file.path)
        return
      }

      if (bundler.validation.enforceUUID && file.data.uuid === undefined) {
        validationResult.push({
          error: new Error('UUID is not defined in the DDF file'),
          path: file.path,
          data: file.data,
        })
      }
    }

    parsedDDFFiles.push(file)
  })

  validationResult.push(...validator.bulkValidate(parsedGenericFiles, parsedDDFFiles))

  await Promise.all(validationResult.map(async (validationError) => {
    const source = await sources.getSource(validationError.path, false)
    const handledErrors = handleError(validationError.error, validationError.path, await source.stringData)
    if (handledErrors.length === 0)
      return

    const currentErrors = errorsByPath.get(validationError.path) ?? []
    currentErrors.push(...handledErrors)
    errorsByPath.set(validationError.path, currentErrors)
  }))

  errorsByPath.forEach((errors, filePath) => {
    core.error(`${errors.length} validation errors for source file at ${filePath}`)
    core.startGroup(`Errors details for source file at ${filePath}`)
    logsErrors(params.source.path.root, errors)
    core.endGroup()
    validationErrors.push(...errors)
  })

  return {
    errorsByPath,
    skippedDDFPaths,
    version: validator.version,
  }
}

export interface MemoryBundle {
  bundle: ReturnType<typeof Bundle>
  path: string
  status: 'added' | 'modified' | 'unchanged'
}

export interface DiskBundle {
  path: string
  status: 'added' | 'modified' | 'unchanged'
}

export interface BundlerResult {
  memoryBundles: MemoryBundle[]
  diskBundles: DiskBundle[]
  validationErrors: ValidationError[]
}

export async function runBundler(params: InputsParams, sources: Sources): Promise<BundlerResult> {
  const { bundler, source, upload } = params

  if (!bundler.enabled)
    throw new Error('Can\'t run bundler because he is not enabled')

  // #region Bundle creation
  core.info('Creating bundles')

  const memoryBundles: MemoryBundle[] = []
  const diskBundles: DiskBundle[] = []
  const validationErrors: ValidationError[] = []

  const bundlerOutputPath = bundler.outputPath
    ?? (upload.artifact.enabled
      ? await fs.mkdtemp(path.join(tmpdir(), 'ddf-bundler'))
      : undefined)

  const validationState = bundler.validation.enabled
    ? await createGlobalValidationState(params, sources, validationErrors)
    : undefined

  core.info(`Bundler output path:${bundlerOutputPath ?? 'Memory'}`)

  const ddfPaths = sources.getDDFPaths()
  let processedBundles = 0

  for (let index = 0; index < ddfPaths.length; index += BUNDLER_CONCURRENCY) {
    const batch = ddfPaths.slice(index, index + BUNDLER_CONCURRENCY)

    await Promise.all(batch.map(async (ddfPath) => {
      core.debug(`[bundler] Bundling DDF ${ddfPath}`)
      try {
        let status: FileStatus = 'unchanged'

        const bundle = await buildFromFiles(
          `file://${source.path.generic}`,
          `file://${ddfPath}`,
          async (filePath) => {
            const currentSource = await sources.getSource(filePath.replace('file://', ''))

            if (currentSource.metadata.status === 'unchanged' || currentSource.metadata.status === 'missing')
              return currentSource

            if (filePath === ddfPath && currentSource.metadata.status === 'added')
              status = 'added'
            else if (status === 'unchanged')
              status = 'modified'

            return currentSource
          },
        )

        core.debug(`[bundler] Bundle created for DDF ${ddfPath} with status ${status}`)

        if (validationState) {
          core.debug(`[bundler] Projecting validation for DDB file ${ddfPath}`)

          if (validationState.skippedDDFPaths.has(ddfPath)) {
            bundle.data.validation = {
              result: 'skipped',
              version: validationState.version,
            }
          }
          else {
            const bundleValidationPaths: Map<string, string> = new Map([[ddfPath, ddfPath]])
            const bundleRootPath = path.dirname(path.dirname(ddfPath))
            const errors: ValidationError[] = []

            bundle.data.files.forEach((file) => {
              const absoluteFilePath = path.join(bundleRootPath, file.path)

              if (file.data.length === 0) {
                errors.push({
                  type: 'simple',
                  message: 'Empty or missing file',
                  file: absoluteFilePath,
                })
              }

              if (file.type === 'JSON') {
                bundleValidationPaths.set(absoluteFilePath, absoluteFilePath)

                if (file.path === 'generic/constants_min.json') {
                  bundleValidationPaths.set(
                    path.join(bundleRootPath, 'generic/constants.json'),
                    absoluteFilePath,
                  )
                }
              }
            })

            bundleValidationPaths.forEach((bundleFilePath, validationFilePath) => {
              const fileErrors = validationState.errorsByPath.get(validationFilePath)
              if (!fileErrors)
                return

              errors.push(...fileErrors.map(error => ({ ...error, file: bundleFilePath })))
            })

            bundle.data.validation = errors.length === 0
              ? {
                  result: 'success',
                  version: validationState.version,
                }
              : {
                  result: 'error',
                  version: validationState.version,
                  errors,
                }

            if (errors.length > 0)
              validationErrors.push(...errors)
          }
        }
        core.debug(`[bundler] End validation for ${ddfPath}`)

        bundle.data.hash = await generateHash(bundle.data)

        bundler.signKeys.forEach((privateKey) => {
          bundle.data.signatures.push({
            key: getPublicKey(privateKey),
            signature: createSignature(bundle.data.hash!, privateKey),
          })
        })

        if (bundlerOutputPath) {
          const parsedPath = path.parse(ddfPath)

          if (bundler.outputDirectoryFormat === 'source-tree')
            parsedPath.dir = parsedPath.dir.replace(source.path.devices, '')
          else if (bundler.outputDirectoryFormat === 'flat')
            parsedPath.dir = ''

          if (bundler.outputFileFormat === 'name-hash')
            parsedPath.name = `${parsedPath.name}-${bytesToHex(bundle.data.hash)}`
          else if (bundler.outputFileFormat === 'hash')
            parsedPath.name = bytesToHex(bundle.data.hash)

          parsedPath.ext = '.ddb'
          parsedPath.base = `${parsedPath.name}${parsedPath.ext}`

          const outputPath = path.resolve(path.join(bundlerOutputPath, path.format(parsedPath)))

          const encoded = encode(bundle)
          const data = Buffer.from(await encoded.arrayBuffer())
          await fs.mkdir(path.dirname(outputPath), { recursive: true })
          core.debug(`[bundler] Writing bundle to disk ${outputPath}`)
          await fs.writeFile(outputPath, data)
          diskBundles.push({
            path: outputPath,
            status,
          })
        }

        memoryBundles.push({
          bundle,
          path: ddfPath,
          status,
        })
      }
      catch (err) {
        core.error(`Error while creating bundle ${ddfPath}`)
        const fileSource = await sources.getSource(ddfPath, false)
        const errors = handleError(err, ddfPath, await fileSource.stringData)
        const filePath = ddfPath.replace(source.path.devices, '')
        core.error(`Bundle creation error for DDF at ${filePath}`)
        logsErrors(params.source.path.root, errors)
        validationErrors.push(...errors)
      }
      finally {
        processedBundles++
        core.info(`Bundling progress: ${processedBundles}/${ddfPaths.length}`)
      }
    }))
  }
  // #endregion

  // #region Report unused files
  if (bundler.validation.enabled && bundler.validation.warnUnusedFiles) {
    const messagesMap = {
      ddf: 'Unused DDF file',
      generic: 'Unused generic file',
      misc: 'Unused misc file',
    }

    const unused = sources.getUnusedFiles()

    let inGroup = false
    Object.entries(messagesMap).forEach(([key, message]) => {
      unused[key].forEach((file) => {
        if (inGroup === false) {
          core.startGroup('Unused files')
          inGroup = true
        }
        core.info(`${message}:${file.replace(source.path.root, '')}`)
      })
    })
    if (inGroup)
      core.endGroup()
    else
      core.info('No unused files found')
  }
  // #endregion

  if (validationErrors.length > 0)
    core.setFailed('Bundler finished with validation errors')
  else
    core.info(`Bundler finished: ${memoryBundles.length}`)

  return {
    memoryBundles,
    diskBundles,
    validationErrors,
  }
}
