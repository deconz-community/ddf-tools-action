import fs from 'node:fs/promises'
import path from 'node:path'
import glob from 'fast-glob'
import type { InputsParams } from './input.js'

export interface Source {
  data: Blob
  useCount: number
  last_modified?: Date
}

export type Sources = Awaited<ReturnType<typeof getSources>>

export async function getSources(params: InputsParams) {
  const ddf: Map<string, Source> = new Map()
  const generic: Map<string, Source> = new Map()
  const misc: Map<string, Source> = new Map()

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

  await Promise.all(sourcePaths.map(async (sourcePath) => {
    const inputFilePath = path.resolve(sourcePath)
    getSourceMap(inputFilePath).set(inputFilePath, {
      data: new Blob([await fs.readFile(inputFilePath)]),
      useCount: 0,
    })
  }))

  return {
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
        if (source.useCount === 0)
          unused.ddf.push(filePath)
      })
      generic.forEach((source, filePath) => {
        if (source.useCount === 0)
          unused.generic.push(filePath)
      })
      misc.forEach((source, filePath) => {
        if (source.useCount === 0)
          unused.misc.push(filePath)
      })

      return unused
    },
    getFile: async (filePath: string, updateCount = true): Promise<Blob> => {
      const sourceMap = getSourceMap(filePath)

      const source = sourceMap.get(filePath)
      if (source) {
        if (updateCount)
          source.useCount++
        return source.data
      }
      else {
        const data = new Blob([await fs.readFile(filePath)])
        sourceMap.set(filePath, {
          data,
          useCount: updateCount ? 1 : 0,
        })
        return data
      }
    },
    getLastModified: async (filePath: string): Promise<Date> => {
      if (!params.bundler.enabled)
        throw new Error('getLastModified is not supported when bundler is enabled')

      const sourceMap = getSourceMap(filePath)
      const source = sourceMap.get(filePath)
      if (!source)
        throw new Error(`Trying to get the modified date of a file that is not loaded filePath=${filePath}`)

      if (source.last_modified)
        return source.last_modified

      switch (params.bundler.fileModifiedMethod) {
        case 'gitlog': {
          // TODO: Implement gitlog
          source.last_modified = new Date(1714319023000)
          break
        }
        case 'mtime': {
          source.last_modified = (await fs.stat(filePath)).mtime
          break
        }
        case 'ctime': {
          source.last_modified = (await fs.stat(filePath)).atime
          break
        }
      }

      return source.last_modified
    },

  }
}
