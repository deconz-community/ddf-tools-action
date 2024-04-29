import { type Bundle, encode } from '@deconz-community/ddf-bundler'
import * as core from '@actions/core'
import { authentication, createDirectus, rest, serverHealth, staticToken } from '@directus/sdk'
import type { InputsParams } from './input'
import { handleError, logsErrors } from './errors'

type UploadResponse = Record<string, {
  success: true
  createdId: string
} | {
  success: false
  code: 'bundle_hash_already_exists' | 'unknown'
  message: string
}>

export async function runUploader(params: InputsParams, memoryBundles: ReturnType<typeof Bundle>[]) {
  const { upload } = params
  if (!upload.enabled)
    throw new Error('Can\'t run uploader because he is not enabled')

  // #region Packing bundles
  core.info('Packing bundles')
  const bundles: Blob[] = []
  if (upload.inputPath === undefined) {
    memoryBundles.forEach((bundle) => {
      bundles.push(encode(bundle))
    })
  }

  core.info(`${bundles.length} bundles packed`)
  // #endregion

  // #region Upload
  const client = createDirectus(upload.url)
    .with(staticToken(upload.token))
    .with(rest())

  try {
    const health = await client.request(serverHealth())

    if (health.status !== 'ok')
      throw new Error(`Server health is not ok: ${health.status}`)

    core.info(`health.status=${health.status}`)
  }
  catch (error) {
    logsErrors(handleError(error))
    throw core.setFailed('Failed to check server health, please check logs for more information')
  }

  const bulkSize = 10

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
          path: '/bundle/upload',
          body: formData,
          headers: { 'Content-Type': 'multipart/form-data' },
        }
      })

      Object.entries(result).forEach(([key, value]) => {
        const bundleName = memoryBundles[Number.parseInt(key.replace('bundle-#', ''))]?.data.name

        // TODO: Remove this temporary code, waiting for the extension update release
        if (value.success === false)
          value.code = value.message === 'Bundle with same hash already exists' ? 'bundle_hash_already_exists' : 'unknown'

        if (value.success)
          core.info(`Uploaded bundle '${bundleName}' with id ${value.createdId} on the store.`)
        else if (value.code === 'bundle_hash_already_exists')
          core.info(`Uploaded bundle '${bundleName}' already exists on the store.`)
        else
          core.error(`Failed to upload bundle '${bundleName}' with code ${value.code}: ${value.message}`)
      })

      core.info(`Uploaded ${group.length} bundles`)
      core.info(JSON.stringify(result, null, 2))
    }
    catch (error) {
      core.setFailed('Failed to upload bundles, please check logs for more information')
      throw logsErrors(handleError(error))
    }
  }

  core.info('Uploading bundles')

  // #endregion
}
