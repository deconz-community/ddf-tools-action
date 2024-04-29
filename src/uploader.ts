import { type Bundle, encode } from '@deconz-community/ddf-bundler'
import * as core from '@actions/core'
import { authentication, createDirectus, rest, serverHealth, staticToken } from '@directus/sdk'
import type { InputsParams } from './input'

type UploadResponse = Record<string, {
  success: boolean
  createdId?: string
  message?: string
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

  const health = await client.request(serverHealth())

  if (health.status !== 'ok')
    throw new Error(`Server health is not ok: ${health.status}`)

  core.info(`health.status=${health.status}`)

  const bulkSize = 10

  for (let i = 0; i < bundles.length; i += bulkSize) {
    const group = bundles.slice(i, i + bulkSize)
    const formData = new FormData()

    for (let j = 0; j < group.length; j++) {
      const bundle = group[j]
      formData.append(`bundle-${i + j + 1}`, bundle)
    }

    try {
      const result = await client.request<{ result: UploadResponse }>(() => {
        return {
          method: 'POST',
          path: '/bundle/upload',
          body: formData,
          headers: { 'Content-Type': 'multipart/form-data' },
        }
      })

      core.info(`Uploaded ${group.length} bundles`)
      core.info(JSON.stringify(result, null, 2))
    }
    catch (e) {
      core.error(JSON.stringify(e, null, 2))
    }
  }

  core.info('Uploading bundles')

  // #endregion
}
