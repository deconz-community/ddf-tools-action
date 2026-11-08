import type { context as githubContext } from '@actions/github'
import type { BundlerResult } from './bundler'
import type { InputsParams } from './input'
import { readFile } from 'node:fs/promises'
import { DefaultArtifactClient } from '@actions/artifact'
import * as core from '@actions/core'
import { encode } from '@deconz-community/ddf-bundler'
import { createStoreClient, uploadBundles } from '@deconz-community/store-api-client'
import { glob } from 'fast-glob'
import { handleError, logsErrors } from './errors'

type Context = typeof githubContext

export type UploaderResult = Awaited<ReturnType<typeof runUploaders>>

export async function runUploaders(params: InputsParams, context: Context, bundlerResult: BundlerResult) {
  return {
    store: params.upload.store.enabled
      ? await runStoreUploader(params, context, bundlerResult)
      : undefined,
    artifact: params.upload.artifact.enabled
      ? await runArtifactUploader(params, context, bundlerResult)
      : undefined,
  }
}

export async function runStoreUploader(params: InputsParams, context: Context, bundlerResult: BundlerResult) {
  core.info('Run store uploader')

  const storeParams = params.upload.store

  if (!storeParams.enabled)
    throw new Error('Can\'t run store uploader because he is not enabled')

  // #region Packing bundles
  const bundles: { name: string, content: Blob }[] = []

  if (storeParams.inputPath === undefined) {
    core.info('Using memory bundles')
    bundlerResult.memoryBundles.forEach(({ bundle, path }) => {
      bundles.push({ name: path, content: encode(bundle) })
    })
    core.info(`${bundles.length} bundles packed`)
  }
  else {
    core.info(`Looking for bundles at ${storeParams.inputPath}`)
    const fileList = await glob(`${storeParams.inputPath}**/*.ddb`, { onlyFiles: true })
    core.info(`Found ${fileList.length} bundles on the disk to upload`)
    for (const file of fileList) {
      const fileContent = await readFile(file)
      bundles.push({ name: file, content: new Blob([fileContent]) })
    }
  }
  // #endregion

  // #region Store Upload
  const client = createStoreClient({
    url: storeParams.url,
    token: storeParams.token,
  })

  try {
    const response = await fetch(`${storeParams.url.replace(/\/+$/, '')}/health`)

    if (!response.ok)
      throw new Error(`Server health check failed: ${response.status} ${response.statusText}`)

    core.info('Store health check passed')
  }
  catch (error) {
    core.setFailed('Failed to check server health, please check logs for more information')
    throw logsErrors(params.source.path.root, handleError(error))
  }

  const bulkSize = 10

  const resultCount = {
    success: 0,
    failed: 0,
    alreadyExists: 0,
  }

  core.startGroup('Upload bundles details')
  for (let i = 0; i < bundles.length; i += bulkSize) {
    const group = bundles.slice(i, i + bulkSize)

    try {
      const { results } = await uploadBundles(client, group, storeParams.status)

      results.forEach((result) => {
        if (result.success) {
          resultCount.success++
          core.info(`Uploaded bundle '${result.file}' with id ${result.id} on the store.`)
        }
        else if (result.error.code === 'bundle_hash_already_exists') {
          resultCount.alreadyExists++
          core.info(`DDB file '${result.file}' already exists on the store. Do nothing.`)
        }
        else {
          resultCount.failed++
          core.error(`Failed to upload DDB file '${result.file}' with code ${result.error.code}: ${result.error.message}`)
        }
      })
    }
    catch (error) {
      core.setFailed('Failed to upload DDB files, please check logs for more information')
      throw logsErrors(params.source.path.root, handleError(error))
    }
  }

  core.endGroup()

  core.info(`Uploaded ${resultCount.success} new bundles, ${resultCount.alreadyExists} already exists and ${resultCount.failed} failed`)

  if (resultCount.failed > 0)
    throw core.setFailed('Failed to upload DDB files, please check logs for more information')

  return resultCount
  // #endregion
}

// #region Upload bundle as artifacts
export async function runArtifactUploader(params: InputsParams, context: Context, bundlerResult: BundlerResult) {
  core.info('Run artifact uploader')

  const artifactParams = params.upload.artifact

  if (!artifactParams.enabled || !params.bundler.enabled)
    throw new Error('Can\'t run store uploader because he is not enabled')

  const { filter } = artifactParams

  const bundlesToUpload = filter
    ? bundlerResult.diskBundles.filter(bundle => filter.includes(bundle.status))
    : bundlerResult.diskBundles

  core.info(`Found ${bundlesToUpload.length}/${bundlerResult.diskBundles.length} bundles to upload as artifact`)

  if (bundlesToUpload.length > 0) {
    core.startGroup('Upload bundles as artifact')

    if (!params.bundler.outputPath)
      throw new Error('Can\'t upload bundles as artifact because outputPath is not defined')

    const artifact = new DefaultArtifactClient()

    const { id, size } = await artifact.uploadArtifact(
      'Bundles',
      bundlesToUpload.map(bundle => bundle.path),
      params.bundler.outputPath,
      {
        retentionDays: artifactParams.retentionDays,
      },
    )
    core.endGroup()

    core.info(`Created artifact with id: ${id} (bytes: ${size}) with a duration of ${artifactParams.retentionDays} days`)

    return { id, size }
  }

  core.info('Run artifact uploader done')
}
// #endregion
