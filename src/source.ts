import fs from 'node:fs/promises'
import path from 'node:path'
import glob from 'fast-glob'
import { type Source, type SourceMetadata, createSource } from '@deconz-community/ddf-bundler'
import type { InputsParams } from './input.js'

export type BundlerSourceMetadata = SourceMetadata & {
  useCount: number
  modified: boolean
}

export type Sources = Awaited<ReturnType<typeof getSources>>

export async function getSources(params: InputsParams, modifiedFiles?: string[]) {
  const ddf: Map<string, Source<BundlerSourceMetadata>> = new Map()
  const generic: Map<string, Source<BundlerSourceMetadata>> = new Map()
  const misc: Map<string, Source<BundlerSourceMetadata>> = new Map()

  const isModified = (filePath: string) => {
    if (!modifiedFiles)
      return false

    const index = modifiedFiles.indexOf(filePath)
    if (index !== undefined && index !== -1) {
      modifiedFiles.splice(index, 1)
      return true
    }

    return false
  }

  const sourcePaths = await glob(
    params.source.path.generic.startsWith(params.source.path.devices)
      ? `${params.source.path.devices}/${params.source.pattern.search}`
      : [
        `${params.source.path.generic}/${params.source.pattern.search}`,
        `${params.source.path.devices}/${params.source.pattern.search}`,
        ],
    {
      ignore: params.source.pattern.ignore ? [params.source.pattern.ignore] : [],
      onlyFiles: true,
    },
  )

  const getSourceMap = (filePath: string) => {
    if (!filePath.endsWith('.json'))
      return misc

    if (filePath.startsWith(params.source.path.generic))
      return generic

    return ddf
  }

  const getLastModified = async (filePath: string) => {
    if (!params.bundler.enabled)
      throw new Error('getLastModified is not supported when bundler is enabled')

    switch (params.bundler.fileModifiedMethod) {
      case 'gitlog': {
        // TODO: Implement gitlog
        return new Date(1714319023000)
      }
      case 'mtime': {
        return (await fs.stat(filePath)).mtime
      }
      case 'ctime': {
        return (await fs.stat(filePath)).atime
      }
    }

    return new Date()
  }

  await Promise.all(sourcePaths.map(async (sourcePath) => {
    const inputFilePath = path.resolve(sourcePath)

    getSourceMap(inputFilePath).set(inputFilePath, createSource<BundlerSourceMetadata>(
      new Blob([await fs.readFile(inputFilePath)]),
      {
        path: inputFilePath,
        last_modified: await getLastModified(inputFilePath),
        useCount: 0,
        modified: isModified(inputFilePath),
      },
    ))
  }))

  return {
    haveExtraModifiedFiles: Boolean(modifiedFiles?.length),
    getDDFPaths: () => Array.from(ddf.keys()),
    getGenericPaths: () => Array.from(generic.keys()),
    getMiscFilesPaths: () => Array.from(misc.keys()),
    getUnusedFiles: () => {
      const unused: Record<string, string[]> = {
        ddf: [],
        generic: [],
        misc: [],
      }

      ddf.forEach((source, filePath) => {
        if (source.metadata.useCount === 0)
          unused.ddf.push(filePath)
      })

      generic.forEach((source, filePath) => {
        if (source.metadata.useCount === 0)
          unused.generic.push(filePath)
      })

      misc.forEach((source, filePath) => {
        if (source.metadata.useCount === 0)
          unused.misc.push(filePath)
      })

      return unused
    },
    getSource: async (filePath: string, updateCount = true): Promise<Source<BundlerSourceMetadata>> => {
      const sourceMap = getSourceMap(filePath)

      const source = sourceMap.get(filePath)
      if (source) {
        if (updateCount)
          source.metadata.useCount++
        return source
      }
      else {
        const source = createSource<BundlerSourceMetadata>(
          new Blob([await fs.readFile(filePath)]),
          {
            path: filePath,
            last_modified: await getLastModified(filePath),
            useCount: updateCount ? 1 : 0,
            modified: isModified(filePath),
          },
        )
        sourceMap.set(filePath, source)
        return source
      }
    },
  }
}
