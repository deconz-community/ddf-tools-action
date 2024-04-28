import * as core from '@actions/core'
import { buildFromFiles } from '@deconz-community/ddf-bundler'
import type { InputsParams } from './input'
import type { Sources } from './source'

export async function runBundler(params: InputsParams, sources: Sources) {
  if (!params.bundler.enabled)
    throw new Error('Can\'t run bundler because he is not enabled')

  sources.getDDFPaths().forEach(async (ddfPath) => {
    core.info(`Found DDF ${ddfPath}`)

    const bundle = await buildFromFiles(
      params.source.path.generic,
      ddfPath,
      sources.getFile,
    )

    core.info(`Bundle ${ddfPath} created`)
    core.info(JSON.stringify(bundle.data.desc, null, 2))
  })
}
