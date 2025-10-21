import type { InputsParams } from './input'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { createDirectus, rest, staticToken } from '@directus/sdk'
import { Octokit } from '@octokit/action'
import { removeDuplicateUUIDs, type Sources } from './source'

export async function autoCommitUuid(params: InputsParams, sources: Sources) {
  if (params.upload.store.url === undefined || params.upload.store.token === undefined)
    throw core.setFailed('Store info is missing, can\'t add UUID')

  const context = github.context

  if (!['push', 'workflow_dispatch'].includes(context.eventName))
    throw core.setFailed(`Got a ${context.eventName} instead of a push event, skipping the UUID auto-commit`)

  await removeDuplicateUUIDs(sources)

  const filesWithMissingUUID: {
    path: string
    relativePath: string
    content: string
  }[] = []

  // #region Find all the files that are missing the UUID
  await Promise.all(sources.getDDFPaths().map(async (ddfPath) => {
    try {
      const source = await sources.getSource(ddfPath)
      const decoded = await source.jsonData

      if (!('uuid' in decoded)) {
        filesWithMissingUUID.push({
          path: ddfPath,
          relativePath: ddfPath.replace(`${params.source.path.root}/`, ''),
          content: await source.stringData,
        })
      }
    }
    catch (error) {
      core.error(`Error while reading DDF file at ${ddfPath}`)
      core.setFailed('Something went wrong while reading DDF file while validating UUID')
    }
  }))

  if (filesWithMissingUUID.length === 0) {
    core.info('No files are missing the UUID')
    return
  }

  core.startGroup(`Found ${filesWithMissingUUID.length} files missing the UUID`)
  filesWithMissingUUID.forEach(file => core.info(`- ${file.path}`))
  core.endGroup()

  // #endregion

  // #region Get the new UUIDs
  if (filesWithMissingUUID.length > 100)
    throw core.setFailed('Too many files is missing the UUID. Stopping the action.')

  const client = createDirectus(params.upload.store.url)
    .with(staticToken(params.upload.store.token))
    .with(rest())
  const newUUIDs = await client.request<{ expire_at: string, uuid: string[] }>(() => {
    return {
      method: 'GET',
      path: 'bundle/generateUUID',
      params: {
        count: filesWithMissingUUID.length,
      },
    }
  })
  // #endregion

  // #region Insert the UUID in the files
  await Promise.all(filesWithMissingUUID.map(async ({ path, relativePath, content }, index) => {
    const newLineCharacter = content.includes('\r\n') ? '\r\n' : '\n'
    const filePart = content.split(newLineCharacter)

    if (filePart.length < 10) {
      console.error(`File ${relativePath} seems invalid, less that 10 lines in the file.`)
      return
    }
    // Find the first line that contains "schema"
    const schemaLineIndex = filePart.findIndex(line => line.includes('devcap1.schema.json'))

    // Insert the UUID line after the schema line
    filePart
      .splice(schemaLineIndex + 1, 0, filePart[schemaLineIndex]
        .replace('schema', 'uuid')
        .replace('devcap1.schema.json', newUUIDs.uuid[index]))

    // Write the file back (in memory)
    const newContent = filePart.join(newLineCharacter)
    sources.updateContent(path, newContent)
    filesWithMissingUUID[index].content = newContent
  }))
  // #endregion

  // #region Commit the changes
  const octokit = new Octokit()

  // Get the current commit object
  const commit = await octokit.rest.repos.getCommit({
    ...context.repo,
    ref: context.sha,
  })

  // Create a blob for each file
  const blobs = await Promise.all(filesWithMissingUUID.map(async (file) => {
    return octokit.rest.git.createBlob({
      ...context.repo,
      content: file.content,
      encoding: 'utf-8',
    })
  }))

  // Create tree with the blobs
  const tree = await octokit.rest.git.createTree({
    ...context.repo,
    base_tree: commit.data.sha,
    tree: blobs.map((blob, index) => ({
      path: filesWithMissingUUID[index].relativePath,
      mode: '100644',
      type: 'blob',
      sha: blob.data.sha,
    })),
  })

  // Create a new commit
  const newCommit = await octokit.rest.git.createCommit({
    ...context.repo,
    message: 'Add missing UUIDs',
    tree: tree.data.sha,
    parents: [commit.data.sha],
  })

  // Update the reference
  await octokit.rest.git.updateRef({
    ...context.repo,
    ref: context.ref.replace('refs/', ''),
    sha: newCommit.data.sha,
  })

  core.info(`UUIDs added to the files, commit created : ${newCommit.data.sha}`)
  // # endregion
}
