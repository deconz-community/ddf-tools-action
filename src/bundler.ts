import path from 'node:path'
import fs from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { tmpdir } from 'node:os'
import * as core from '@actions/core'
import type { Bundle, ValidationError } from '@deconz-community/ddf-bundler'
import { buildFromFiles, createSignature, encode, generateHash } from '@deconz-community/ddf-bundler'
import type { FileDefinitionWithError } from '@deconz-community/ddf-validator'
import { createValidator } from '@deconz-community/ddf-validator'
import { bytesToHex } from '@noble/hashes/utils'
import { secp256k1 } from '@noble/curves/secp256k1'
import type { InputsParams } from './input'
import type { FileStatus, Sources } from './source'
import { handleError, logsErrors } from './errors'

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

  core.info(`Bundler output path:${bundlerOutputPath ?? 'Memory'}`)

  await Promise.all(sources.getDDFPaths().map(async (ddfPath) => {
    core.debug(`[bundler] Bundling DDF ${ddfPath}`)
    try {
      let status: FileStatus = 'unchanged'
      const bundle = await buildFromFiles(
        `file://${source.path.generic}`,
        `file://${ddfPath}`,
        async (filePath) => {
          const source = await sources.getSource(filePath.replace('file://', ''))
          core.info(`Reading file: ${filePath.replace('file://', '')} with size : ${(await source.stringData).length}`)

          if (source.metadata.status === 'unchanged')
            return source

          if (filePath === ddfPath && source.metadata.status === 'added')
            status = 'added'
          else if (status === 'unchanged')
            status = 'modified'

          return source
        },
      )

      core.debug(`[bundler] Bundle created for DDF ${ddfPath} with status ${status}`)

      // #region Validation
      // Anonymous function to use return and parent scope
      await (async () => {
        if (bundler.validation.enabled) {
          core.debug(`[bundler] Validating bundle DDF ${ddfPath}`)

          const validator = createValidator()
          const validationResult: FileDefinitionWithError[] = []

          const ddfcFile = bundle.data.files.find(file => file.type === 'DDFC')
          if (!ddfcFile) {
            validationResult.push({
              error: new Error('No DDFC file found in the bundle'),
              path: ddfPath,
              data: null,
            })
            return
          }

          const ddfc = JSON.parse(ddfcFile.data)

          if (typeof ddfc !== 'object' || ddfc === null) {
            validationResult.push({
              error: new Error('Something went wrong while parsing the DDFC file'),
              path: ddfPath,
              data: ddfc,
            })
            return
          }

          if (bundler.validation.enforceUUID && ddfc.uuid === undefined) {
            validationResult.push({
              error: new Error('UUID is not defined in the DDFC file'),
              path: ddfPath,
              data: ddfc,
            })
          }

          core.info(`Validating DDFC file ${ddfPath} with content${JSON.stringify(ddfc)}`)

          if (ddfc.ddfvalidate === false && !bundler.validation.strict) {
            core.warning(`[bundler] Skipping validation for bundle DDF ${ddfPath}`)

            bundle.data.validation = {
              result: 'skipped',
              version: validator.version,
            }
            return
          }

          core.info(`Starting bulkValidate DDFC file ${ddfPath}`)
          validationResult.push(...validator.bulkValidate(
            // Generic files
            bundle.data.files
              .filter(file => file.type === 'JSON')
              .map((file) => {
                return {
                  path: file.path,
                  data: JSON.parse(file.data as string),
                }
              }),
            // DDF file
            [
              {
                path: ddfPath,
                data: ddfc,
              },
            ],
          ))

          if (validationResult.length === 0) {
            core.debug(`[bundler] Validating success for bundle DDF ${ddfPath}`)
            bundle.data.validation = {
              result: 'success',
              version: validator.version,
            }
            return
          }

          const errors: ValidationError[] = []

          await Promise.all(validationResult.map(async (error) => {
            core.info(`Validation error for ${error.path} ${JSON.stringify(error)} `)
            const sourceFile = await sources.getSource(error.path)
            errors.push(...handleError(error.error, error.path, await sourceFile.stringData))
          }))

          if (errors.length > 0) {
            const filePath = ddfPath.replace(source.path.devices, '')
            core.error(`Bundle validation error for DDF at ${filePath}`)
            logsErrors(params.source.path.root, errors)
            validationErrors.push(...errors)
          }

          core.debug(`[bundler] Validating done with errors ${ddfPath} with ${errors.length} errors;${JSON.stringify(errors)}`)
          bundle.data.validation = {
            result: 'error',
            version: validator.version,
            errors,
          }
        }
      })()
      core.debug(`[bundler] End validation for ${ddfPath}`)
      // #endregion

      // #region Hash & Signatures
      bundle.data.hash = await generateHash(bundle.data)

      bundler.signKeys.forEach((privateKey) => {
        bundle.data.signatures.push({
          key: secp256k1.getPublicKey(privateKey),
          signature: createSignature(bundle.data.hash!, privateKey),
        })
      })
      // #endregion

      // #region Write bundle to disk
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

        parsedPath.ext = '.ddf'
        parsedPath.base = `${parsedPath.name}${parsedPath.ext}`

        const outputPath = path.resolve(path.join(bundlerOutputPath, path.format(parsedPath)))

        const encoded = encode(bundle)
        const data = Buffer.from(await encoded.arrayBuffer())
        fs.mkdir(path.dirname(outputPath), { recursive: true })
        core.debug(`[bundler] Writing bundle to disk ${outputPath}`)
        await fs.writeFile(outputPath, data)
        diskBundles.push({
          path: outputPath,
          status,
        })
      }
      // #endregion

      memoryBundles.push({
        bundle,
        path: ddfPath,
        status,
      })
    }
    catch (err) {
      core.error(`Error while creating bundle ${ddfPath}`)
      const fileSource = await sources.getSource(ddfPath)
      const errors = handleError(err, ddfPath, await fileSource.stringData)
      const filePath = ddfPath.replace(source.path.devices, '')
      core.error(`Bundle creation error for DDF at ${filePath}`)
      logsErrors(params.source.path.root, errors)
      validationErrors.push(...errors)
    }
  }))
  // #endregion

  // #region Validation of unused files
  // Anonymous function to use return and parent scope
  await (async () => {
    if (bundler.validation.enabled) {
      core.info('Validating unused files')

      const unused = sources.getUnusedFiles()

      const validator = createValidator()

      const genericFiles = await Promise.all(unused.generic.map(async (path) => {
        const source = await sources.getSource(path)
        return {
          path,
          data: JSON.parse(await source.stringData),
        }
      }))

      // Re validate constants file because he was chopped before
      const constantsPath = path.join(params.source.path.generic, 'constants.json')
      genericFiles.push({
        path: constantsPath,
        data: JSON.parse(await (await sources.getSource(constantsPath)).stringData),
      })

      // Load used generic files
      await Promise.all(sources
        .getGenericPaths()
        .filter(path => !unused.generic.includes(path))
        .map(async (path) => {
          try {
            const source = await sources.getSource(path)
            const data = JSON.parse(await source.stringData)
            validator.loadGeneric(data)
          }
          catch (err) {
            // Ignore errors because they already have been validated before
          }
        }),
      )

      const validationResult = validator.bulkValidate(genericFiles, [])

      await Promise.all(validationResult.map(async (error) => {
        const source = await sources.getSource(error.path)
        const errors = handleError(error.error, error.path, await source.stringData)
        if (errors.length > 0) {
          core.error('Validation error for unused files')
          logsErrors(params.source.path.root, errors)
          validationErrors.push(...errors)
        }
      }))

      if (bundler.validation.warnUnusedFiles) {
        const messagesMap = {
          ddf: 'Unused DDF file',
          generic: 'Unused generic file',
          misc: 'Unused misc file',
        }
        let inGroup = false
        Object.entries(messagesMap).forEach(([key, message]) => {
          unused[key].forEach((file) => {
            if (inGroup === false) {
              core.startGroup('Unused files')
              inGroup = true
            }
            core.warning(`${message}:${file}`, { file })
          })
        })
        if (inGroup)
          core.endGroup()
        else
          core.info('No unused files found')
      }
    }
  })()

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
