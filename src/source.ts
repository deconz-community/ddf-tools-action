import fs from 'node:fs/promises'
import path from 'node:path'
import type { DDF } from '@deconz-community/ddf-validator'
import glob from 'fast-glob'
import * as core from '@actions/core'
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

  await Promise.all(sourcePaths.map(async (sourcePath) => {
    const inputFilePath = path.resolve(sourcePath)
    if (inputFilePath.startsWith(params.source.path.generic)) {
      generic.set(inputFilePath, {
        data: new Blob([await fs.readFile(inputFilePath)]),
        useCount: 0,
      })
    }
    else {
      ddf.set(inputFilePath, {
        data: new Blob([await fs.readFile(inputFilePath)]),
        useCount: 0,
      })
    }
  }))

  const getSourceMap = (filePath: string) => {
    if (ddf.has(filePath))
      return ddf
    if (generic.has(filePath))
      return generic
    return misc
  }

  return {
    getDDFPaths: () => Array.from(ddf.keys()),
    getGenericPaths: () => Array.from(generic.keys()),
    getMiscFilesPaths: () => Array.from(misc.keys()),
    getFile: async (filePath: string): Promise<Blob> => {
      const sourceMap = getSourceMap(filePath)

      const source = sourceMap.get(filePath)
      if (source) {
        source.useCount++
        return source.data
      }
      else {
        const data = new Blob([await fs.readFile(filePath)])
        sourceMap.set(filePath, {
          data,
          useCount: 1,
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
