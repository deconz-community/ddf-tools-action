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

  const bundlerOutputPath = bundler.outputPath
    ?? bundler.artifactEnabled
    ? await fs.mkdtemp('ddf-bundler')
    : undefined

  const writtenFilesPath: string[] = []

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

      if (bundlerOutputPath) {
        const parsedPath = path.parse(ddfPath)
        parsedPath.dir = parsedPath.dir.replace(params.source.path.devices, '')
        parsedPath.ext = '.ddf'
        parsedPath.base = `${parsedPath.name}${parsedPath.ext}`
        const outputPath = path.resolve(path.join(bundlerOutputPath, path.format(parsedPath)))

        const encoded = encode(bundle)
        const data = Buffer.from(await encoded.arrayBuffer())
        fs.mkdir(path.dirname(outputPath), { recursive: true })
        await fs.writeFile(outputPath, data)
        writtenFilesPath.push(outputPath)
      }

      bundles.push(bundle)
    }
    catch (err) {
      core.error(`Error while creating bundle ${ddfPath}`)
      const file = await sources.getFile(ddfPath)
      logsErrors(handleError(err, ddfPath, await file.text()))
    }
  }))

  if (bundler.artifactEnabled) {
    if (!bundlerOutputPath)
      throw new Error('Can\'t upload bundles as artifact because outputPath is not defined')

    const { id, size } = await artifact.uploadArtifact(
      'Bundles',
      writtenFilesPath,
      bundlerOutputPath,
      {
        retentionDays: bundler.artifactRetentionDays,
      },
    )
    core.info(`Created artifact with id: ${id} (bytes: ${size}) with a duration of ${bundler.artifactRetentionDays} days`)
  }

  core.info(`Bundler finished: ${bundles.length}`)

  return bundles
}
