import * as core from '@actions/core'
import type { Bundle } from '@deconz-community/ddf-bundler'
import { buildFromFiles } from '@deconz-community/ddf-bundler'
import type { InputsParams } from './input'
import type { Sources } from './source'
import { handleError } from './errors'

export async function runBundler(params: InputsParams, sources: Sources): Promise<ReturnType<typeof Bundle>[]> {
  if (!params.bundler.enabled)
    throw new Error('Can\'t run bundler because he is not enabled')

  const bundles: ReturnType<typeof Bundle>[] = []

  Promise.all(sources.getDDFPaths().map(async (ddfPath) => {
    core.info(`Found DDF ${ddfPath}`)

    try {
      const bundle = await buildFromFiles(
        `file://${params.source.path.generic}`,
        `file://${ddfPath}`,
        async (path) => {
          const newPath = path.replace('file://', '')
          core.info(`Need file ${newPath}`)
          return await sources.getFile(newPath)
        },
      )

      bundles.push(bundle)

      core.info(`Bundle ${ddfPath} created`)
    }
    catch (err) {
      core.error(`Error while creating bundle ${ddfPath}`)
      const file = await sources.getFile(ddfPath)
      handleError(err, ddfPath, await file.text())
    }
  }))

  return bundles
}
