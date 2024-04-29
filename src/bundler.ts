import path from 'node:path'
import fs from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import * as core from '@actions/core'
import type { Bundle, ValidationError } from '@deconz-community/ddf-bundler'
import { buildFromFiles, createSignature, encode, generateHash } from '@deconz-community/ddf-bundler'
import { DefaultArtifactClient } from '@actions/artifact'
import { createValidator } from '@deconz-community/ddf-validator'
import { bytesToHex } from '@noble/hashes/utils'
import { secp256k1 } from '@noble/curves/secp256k1'
import type { InputsParams } from './input'
import type { Sources } from './source'
import { handleError, logsErrors } from './errors'

export interface MemoryBundle {
  bundle: ReturnType<typeof Bundle>
  path: string
}

export async function runBundler(params: InputsParams, sources: Sources): Promise<MemoryBundle[]> {
  const { bundler, source } = params

  if (!bundler.enabled)
    throw new Error('Can\'t run bundler because he is not enabled')

  // #region Bundle creation
  core.info('Creating bundles')

  const bundles: MemoryBundle[] = []

  const bundlerOutputPath = bundler.outputPath
    ?? (bundler.artifactEnabled
      ? await fs.mkdtemp('ddf-bundler')
      : undefined)

  const writtenFilesPath: string[] = []

  await Promise.all(sources.getDDFPaths().map(async (ddfPath) => {
    core.debug(`[bundler] Bundling DDF ${ddfPath}`)
    try {
      const bundle = await buildFromFiles(
        `file://${source.path.generic}`,
        `file://${ddfPath}`,
        path => sources.getFile(path.replace('file://', '')),
        path => sources.getLastModified(path.replace('file://', '')),
      )

      // #region Validation
      // Anonymous function to use return and parent scope
      await (async () => {
        if (bundler.validation.enabled) {
          const validator = createValidator()

          const ddfc = JSON.parse(bundle.data.ddfc)
          if (typeof ddfc !== 'object' || ddfc === null)
            throw new Error('Something went wrong while parsing the DDFC file')

          if (bundler.validation.enforceUUID && ddfc.uuid === undefined)
            core.error('UUID is not defined in the DDFC file', { file: ddfPath })

          if (ddfc.ddfvalidate === false && bundler.validation.strict) {
            if (bundler.validation.strict)
              core.error('Strict mode enabled and validation is disabled in the DDFC file', { file: ddfPath })

            bundle.data.validation = {
              result: 'skipped',
              version: validator.version,
            }
            return
          }

          const validationResult = validator.bulkValidate(
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
                path: bundle.data.name,
                data: ddfc,
              },
            ],
          )

          if (validationResult.length === 0) {
            bundle.data.validation = {
              result: 'success',
              version: validator.version,
            }
            return
          }

          const errors: ValidationError[] = []

          await Promise.all(validationResult.map(async (error) => {
            const file = await sources.getFile(error.path)
            errors.push(...handleError(error.error, error.path, await file.text()))
          }))

          bundle.data.validation = {
            result: 'error',
            version: validator.version,
            errors,
          }
        }
      })()
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
        await fs.writeFile(outputPath, data)
        writtenFilesPath.push(outputPath)
      }
      // #endregion

      bundles.push({
        bundle,
        path: ddfPath,
      })
    }
    catch (err) {
      core.error(`Error while creating bundle ${ddfPath}`)
      const file = await sources.getFile(ddfPath)
      logsErrors(handleError(err, ddfPath, await file.text()))
    }
  }))
  // #endregion

  // #region Upload bundle as artifacts
  if (bundler.artifactEnabled && bundles.length > 0) {
    core.startGroup('Upload bundles as artifact')

    if (!bundlerOutputPath)
      throw new Error('Can\'t upload bundles as artifact because outputPath is not defined')

    const artifact = new DefaultArtifactClient()

    const { id, size } = await artifact.uploadArtifact(
      'Bundles',
      writtenFilesPath,
      bundlerOutputPath,
      {
        retentionDays: bundler.artifactRetentionDays,
      },
    )
    core.endGroup()

    core.info(`Created artifact with id: ${id} (bytes: ${size}) with a duration of ${bundler.artifactRetentionDays} days`)
  }
  // #endregion

  // #region Validation of unused files
  // Anonymous function to use return and parent scope
  await (async () => {
    if (bundler.validation.enabled) {
      core.info('Validating unused files')

      const unused = sources.getUnusedFiles()

      const validator = createValidator()

      // TODO: Optimise this, it's loading the files twice

      const genericFiles = await Promise.all(unused.generic.map(async (path) => {
        const fileContent = await sources.getFile(path)
        return {
          path,
          data: JSON.parse(await fileContent.text()),
        }
      }))

      // Re validate constants file because he was chopped before
      const constantsPath = path.join(params.source.path.generic, 'constants.json')
      genericFiles.push({
        path: constantsPath,
        data: JSON.parse(await (await sources.getFile(constantsPath)).text()),
      })

      // Load used generic files
      await Promise.all(sources
        .getGenericPaths()
        .filter(path => !unused.generic.includes(path))
        .map(async (path) => {
          try {
            const file = await sources.getFile(path)
            const data = JSON.parse(await file.text())
            validator.loadGeneric(data)
          }
          catch (err) {
            // Ignore errors because they already have been validated before
          }
        }),
      )

      const validationResult = validator.bulkValidate(genericFiles, [])

      await Promise.all(validationResult.map(async (error) => {
        const file = await sources.getFile(error.path)
        logsErrors(handleError(error.error, error.path, await file.text()))
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

  core.info(`Bundler finished: ${bundles.length}`)

  return bundles
}
