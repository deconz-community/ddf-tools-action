import { type Bundle, encode } from '@deconz-community/ddf-bundler'
import * as core from '@actions/core'
import { authentication, createDirectus, rest, serverHealth, staticToken } from '@directus/sdk'
import type { InputsParams } from './input'

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

  core.info(`health.status=${health.status}`)

  core.info('Uploading bundles')

  // #endregion
}
