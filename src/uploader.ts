import { readFile } from 'node:fs/promises'
import { encode } from '@deconz-community/ddf-bundler'
import * as core from '@actions/core'
import { createDirectus, rest, serverHealth, staticToken } from '@directus/sdk'
import { glob } from 'fast-glob'
import { DefaultArtifactClient } from '@actions/artifact'
import type { Context } from '@actions/github/lib/context'
import type { InputsParams } from './input'
import { handleError, logsErrors } from './errors'
import type { BundlerResult } from './bundler'

type UploadResponse = Record<string, {
  success: true
  createdId: string
} | {
  success: false
  code: 'bundle_hash_already_exists' | 'unknown'
  message: string
}>

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
  const bundles: Blob[] = []

  if (storeParams.inputPath === undefined) {
    core.info('Using memory bundles')
    bundlerResult.memoryBundles.forEach(({ bundle }) => {
      bundles.push(encode(bundle))
    })
    core.info(`${bundles.length} bundles packed`)
  }
  else {
    core.info(`Looking for bundles at ${storeParams.inputPath}`)
    const fileList = await glob(`${storeParams.inputPath}**/*.ddf`, { onlyFiles: true })
    core.info(`Found ${fileList.length} bundles on the disk to upload`)
    for (const file of fileList) {
      const fileContent = await readFile(file)
      bundles.push(new Blob([fileContent]))
    }
  }
  // #endregion

  // #region Store Upload
  const client = createDirectus(storeParams.url)
    .with(staticToken(storeParams.token))
    .with(rest())

  try {
    const health = await client.request(serverHealth())

    if (health.status !== 'ok')
      throw new Error(`Server health is not ok: ${health.status}`)

    core.info(`Store status = ${health.status}`)
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
    const formData = new FormData()

    for (let j = 0; j < group.length; j++) {
      const bundle = group[j]
      formData.append(`bundle-#${i + j}`, bundle)
    }

    try {
      const { result } = await client.request<{ result: UploadResponse }>(() => {
        return {
          method: 'POST',
          path: `/bundle/upload/${storeParams.status}`,
          body: formData,
          headers: { 'Content-Type': 'multipart/form-data' },
        }
      })

      Object.entries(result).forEach(([key, value]) => {
        const bundleName = bundlerResult.memoryBundles[Number.parseInt(key.replace('bundle-#', ''))]?.path

        if (value.success) {
          resultCount.success++
          core.info(`Uploaded bundle '${bundleName}' with id ${value.createdId} on the store.`)
        }
        else if (value.code === 'bundle_hash_already_exists') {
          resultCount.alreadyExists++
          core.info(`DDF Bundle '${bundleName}' already exists on the store. Do nothing.`)
        }
        else {
          resultCount.failed++
          core.error(`Failed to upload DDF bundle '${bundleName}' with code ${value.code}: ${value.message}`)
        }
      })
    }
    catch (error) {
      core.setFailed('Failed to upload DDF bundles, please check logs for more information')
      throw logsErrors(params.source.path.root, handleError(error))
    }
  }

  core.endGroup()

  core.info(`Uploaded ${resultCount.success} new bundles, ${resultCount.alreadyExists} already exists and ${resultCount.failed} failed`)

  if (resultCount.failed > 0)
    throw core.setFailed('Failed to upload DDF bundles, please check logs for more information')

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

  core.info(`Found ${bundlesToUpload.length}/${bundlerResult.diskBundles} bundles to upload as artifact`)

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
