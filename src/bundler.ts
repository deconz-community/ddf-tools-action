import path from 'node:path'
import fs from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import * as core from '@actions/core'
import type { Bundle } from '@deconz-community/ddf-bundler'
import { buildFromFiles, createSignature, encode, generateHash } from '@deconz-community/ddf-bundler'
import { DefaultArtifactClient } from '@actions/artifact'
import type { InputsParams } from './input'
import type { Sources } from './source'
import { handleError, logsErrors } from './errors'

const artifact = new DefaultArtifactClient()

export async function runBundler(params: InputsParams, sources: Sources): Promise<ReturnType<typeof Bundle>[]> {
  const { bundler } = params

  if (!bundler.enabled)
    throw new Error('Can\'t run bundler because he is not enabled')

  const bundles: ReturnType<typeof Bundle>[] = []

  await Promise.all(sources.getDDFPaths().map(async (ddfPath) => {
    core.debug(`[bundler] Bundling DDF ${ddfPath}`)
    try {
      const bundle = await buildFromFiles(
        `file://${params.source.path.generic}`,
        `file://${ddfPath}`,
        path => sources.getFile(path.replace('file://', '')),
        path => sources.getLastModified(path.replace('file://', '')),
      )

      bundle.data.hash = await generateHash(bundle.data)

      bundler.signKeys.forEach((key) => {
        bundle.data.signatures.push({
          key,
          signature: createSignature(bundle.data.hash!, key),
        })
      })

      if (bundler.outputPath) {
        const parsedPath = path.parse(ddfPath)
        parsedPath.dir = parsedPath.dir.replace(params.source.path.devices, '')
        parsedPath.ext = '.ddf'
        parsedPath.base = `${parsedPath.name}${parsedPath.ext}`
        const outputPath = path.resolve(path.join(bundler.outputPath, path.format(parsedPath)))

        const encoded = encode(bundle)
        const data = Buffer.from(await encoded.arrayBuffer())
        fs.mkdir(path.dirname(outputPath), { recursive: true })
        await fs.writeFile(outputPath, data)

        const { id, size } = await artifact.uploadArtifact(
          'Bundles',
          [outputPath],
          '.',
          {
            retentionDays: 1,
          },
        )

        core.info(`Created artifact with id: ${id} (bytes: ${size}`)
      }

      bundles.push(bundle)
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
