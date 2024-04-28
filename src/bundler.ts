import * as core from '@actions/core'
import type { Bundle } from '@deconz-community/ddf-bundler'
import { buildFromFiles } from '@deconz-community/ddf-bundler'
import type { InputsParams } from './input'
import type { Sources } from './source'
import { handleError, logsErrors } from './errors'

export async function runBundler(params: InputsParams, sources: Sources): Promise<ReturnType<typeof Bundle>[]> {
  if (!params.bundler.enabled)
    throw new Error('Can\'t run bundler because he is not enabled')

  const bundles: ReturnType<typeof Bundle>[] = []

  await Promise.all(sources.getDDFPaths().map(async (ddfPath) => {
    core.info(`Found DDF ${ddfPath}`)

    try {
      const bundle = await buildFromFiles(
        `file://${params.source.path.generic}`,
        `file://${ddfPath}`,
        path => sources.getFile(path.replace('file://', '')),
      )

      bundles.push(bundle)

      core.info(`Bundle ${ddfPath.replace(params.source.path.devices, '')}.ddf created`)
    }
    catch (err) {
      core.error(`Error while creating bundle ${ddfPath}`)
      const file = await sources.getFile(ddfPath)
      logsErrors(handleError(err, ddfPath, await file.text()))
    }
  }))

  core.info(`Bundler finished: ${bundles.length}`)

  return bundles
}
