import fs from 'node:fs/promises'
import path from 'node:path'
import glob from 'fast-glob'
import { type Source, type SourceMetadata, createSource } from '@deconz-community/ddf-bundler'
import type { Context } from '@actions/github/lib/context.js'
import type { PullRequestEvent } from '@octokit/webhooks-types'
import { Octokit } from '@octokit/action'
import { simpleGit } from 'simple-git'

import * as core from '@actions/core'
import type { InputsParams } from './input.js'

export type FileStatus = 'added' | 'removed' | 'modified' | 'unchanged' | 'missing'

export type BundlerSourceMetadata = SourceMetadata & {
  useCount: number
  status: FileStatus
}

export type Sources = Awaited<ReturnType<typeof getSources>>

export const MAX_MODIFIED_FILES_IN_PR = 2000

async function findGitDirectory(filePath: string): Promise<string | undefined> {
  const directoryPath = path.dirname(filePath)

  try {
    await fs.access(path.join(directoryPath, '.git'))
    return directoryPath
  }
  catch {
    const parentDirectory = path.dirname(directoryPath)
    if (parentDirectory === directoryPath)
      return undefined

    return findGitDirectory(directoryPath)
  }
}

export async function getSources(params: InputsParams, context: Context) {
  const ddf: Map<string, Source<BundlerSourceMetadata>> = new Map()
  const generic: Map<string, Source<BundlerSourceMetadata>> = new Map()
  const misc: Map<string, Source<BundlerSourceMetadata>> = new Map()

  core.debug(`Get sources path : ${params.source.path.generic}`)

  const gitDirectory = await findGitDirectory(params.source.path.devices)
  core.debug(`Git directory : ${gitDirectory}`)

  const git = simpleGit(gitDirectory)

  const fileStatus = context.eventName === 'pull_request'
    ? await getSourcesStatus(context)
    : new Map<string, FileStatus>()

  const getStatus = (filePath: string) => {
    const status = fileStatus.get(filePath)
    if (!status)
      return 'unchanged'
    fileStatus.delete(filePath)
    return status
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
        const log = await git.log({ file: filePath })
        const latestCommit = log.latest
        if (latestCommit === null) {
          core.warning(`No commit found for ${filePath}`)
          return new Date()
        }
        return new Date(latestCommit.date)
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

  const getSource = async (filePath: string, updateCount = true): Promise<Source<BundlerSourceMetadata>> => {
    const sourceMap = getSourceMap(filePath)

    const source = sourceMap.get(filePath)
    if (source) {
      if (updateCount)
        source.metadata.useCount++
      return source
    }

    try {
      const source = createSource<BundlerSourceMetadata>(
        new Blob([await fs.readFile(filePath)]),
        {
          path: filePath,
          last_modified: await getLastModified(filePath),
          useCount: updateCount ? 1 : 0,
          status: getStatus(filePath),
        },
      )

      sourceMap.set(filePath, source)
      return source
    }
    catch {
      const source = createSource<BundlerSourceMetadata>(
        new Blob([]),
        {
          path: filePath,
          last_modified: new Date(0),
          useCount: updateCount ? 1 : 0,
          status: 'missing',
        },
      )
      sourceMap.set(filePath, source)
      return source
    }
  }

  // Load all the DDF sources
  await Promise.all(sourcePaths.map(async (sourcePath) => {
    const filePath = path.resolve(sourcePath)
    return getSource(filePath, true)
  }))

  // List of modified files that are not in the sources, aka not DDF related files
  if (fileStatus.size > 0) {
    core.startGroup('Extra modified files status')
    fileStatus.forEach((status, path) => core.info(`[${status}] ${path}`))
    core.endGroup()
  }

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
    getSource,
    updateContent: (filePath: string, content: string) => {
      core.info(`Updating content of ${filePath}`)
      const sourceMap = getSourceMap(filePath)
      const currentSource = sourceMap.get(filePath)
      const source = createSource<BundlerSourceMetadata>(
        new Blob([content]),
        {
          path: filePath,
          last_modified: new Date(),
          useCount: currentSource?.metadata.useCount ?? 0,
          status: 'modified',
        },
      )
      sourceMap.set(filePath, source)
    },
  }
}

export async function getSourcesStatus(context: Context) {
  if (context.eventName !== 'pull_request')
    throw new Error('This action is not supposed to run on pull_request event')

  const payload = context.payload as PullRequestEvent

  if (payload.pull_request.changed_files > MAX_MODIFIED_FILES_IN_PR) {
    throw new Error(
      `Too many files changed in this PR. `
      + `When I made this tool I did not think that was `
      + `possible to have more than ${MAX_MODIFIED_FILES_IN_PR} files modified`,
    )
  }

  const octokit = new Octokit()

  const fileStatus: Map<string, FileStatus> = new Map()

  const files = await octokit.rest.pulls.listFiles({
    ...context.repo,
    per_page: MAX_MODIFIED_FILES_IN_PR,
    pull_number: payload.pull_request.number,
  })

  if (core.isDebug())
    core.debug(`Pull request files list = ${JSON.stringify(files, null, 2)}`)

  files.data.forEach((file) => {
    const filePath = path.resolve(file.filename)
    switch (file.status) {
      case 'modified':
      case 'added':
      case 'removed':
        fileStatus.set(filePath, file.status)
        break
      case 'renamed':
        fileStatus.set(filePath, 'unchanged')
        break
      default:
        throw new Error(`Unknown file status: ${file.status}`)
    }
  })

  return fileStatus
}

export async function removeDuplicateUUIDs(sources: Sources) {
  const uuids: Record<string, string[]> = {}
  await Promise.all(sources.getDDFPaths().map(async (ddfPath) => {
    const source = await sources.getSource(ddfPath)
    const decoded = await source.jsonData
    if ('uuid' in decoded && typeof decoded.uuid === 'string') {
      if (decoded.uuid in uuids)
        uuids[decoded.uuid].push(ddfPath)
      else
        uuids[decoded.uuid] = [ddfPath]
    }
  }))

  await Promise.all(Object.entries(uuids).map(async ([uuid, paths]) => {
    if (paths.length === 1)
      return

    core.startGroup(`Removing duplicate UUID ${uuid}`)

    const source_list = await Promise.all(paths.map(path => sources.getSource(path)))
    source_list.sort((a, b) => {
      const a_metadata = a.metadata
      const b_metadata = b.metadata
      if (a_metadata.last_modified < b_metadata.last_modified)
        return -1
      if (a_metadata.last_modified > b_metadata.last_modified)
        return 1
      return 0
    })

    core.info(`Keeping UUID for ${source_list[0].metadata.path}`)

    await Promise.all(source_list.slice(1).map(async (source) => {
      core.info(`Removing UUID for ${source.metadata.path}`)
      const content = await source.stringData
      const newLineCharacter = content.includes('\r\n') ? '\r\n' : '\n'
      const filePart = content.split(newLineCharacter)
      const regex = new RegExp(`"uuid"\\s*:\\s*"${uuid}"`)

      const newContent = filePart.filter(line => !regex.test(line)).join(newLineCharacter)
      sources.updateContent(source.metadata.path, newContent)
    }))

    core.endGroup()
  }))
}
