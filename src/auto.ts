import fs from 'node:fs/promises'
import * as core from '@actions/core'
import { createDirectus, rest, staticToken } from '@directus/sdk'
import { Octokit } from '@octokit/action'
import * as github from '@actions/github'
import type { InputsParams } from './input'
import type { Sources } from './source'

export async function autoCommitUuid(params: InputsParams, sources: Sources): Promise<boolean> {
  if (params.upload.store.url === undefined || params.upload.store.token === undefined)
    throw core.setFailed('Store info is missing, can\'t add UUID')

  const context = github.context

  if (context.eventName !== 'push')
    throw core.setFailed('Not a push event, skipping the UUID auto-commit')

  const filesWithMissingUUID: {
    path: string
    content: string
  }[] = []

  // #region Find all the files that are missing the UUID
  sources.getDDFPaths().forEach(async (ddfPath) => {
    try {
      const source = await sources.getSource(ddfPath)

      if (source.metadata.status === 'unchanged')
        return

      const decoded = await source.jsonData
      if (!('uuid' in decoded)) {
        filesWithMissingUUID.push({
          path: ddfPath,
          content: await source.stringData,
        })
      }
    }
    catch (error) {
      core.error(`Error while reading DDF file at ${ddfPath}`)
      core.setFailed('Something went wrong while reading DDF file while validating UUID')
    }
  })

  if (filesWithMissingUUID.length === 0) {
    core.info('No files are missing the UUID')
    return false
  }

  core.info(`Found ${filesWithMissingUUID.length} files missing the UUID`)

  // #endregion

  // #region Get the new UUIDs
  if (filesWithMissingUUID.length > 100) {
    core.error('Too many files is missing the UUID. Stopping the action.')
    return true
  }

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
  await Promise.all(filesWithMissingUUID.map(async ({ path, content }, index) => {
    const newLineCharacter = content.includes('\r\n') ? '\r\n' : '\n'
    const filePart = content.split(newLineCharacter)

    if (filePart.length < 10) {
      console.error(`File ${path} seems invalid, less that 10 lines in the file.`)
      return
    }
    // Find the first line that contains "schema"
    const schemaLineIndex = filePart.findIndex(line => line.includes('devcap1.schema.json'))

    // Insert the UUID line after the schema line
    filePart.splice(schemaLineIndex + 1, 0, filePart[schemaLineIndex].replace('schema', 'uuid').replace('devcap1.schema.json', newUUIDs.uuid[index]))
    // Write the file back
    await fs.writeFile(path, filePart.join(newLineCharacter))
  }))
  // #endregion

  // #region Commit the changes
  const octokit = new Octokit()

  // Get the current commit object
  const commit = await octokit.rest.repos.getCommit({
    owner: context.repo.owner,
    repo: context.repo.repo,
    ref: context.sha,
  })

  // Create a blob for each file
  const blobs = await Promise.all(filesWithMissingUUID.map(async (file) => {
    return octokit.rest.git.createBlob({
      owner: context.repo.owner,
      repo: context.repo.repo,
      content: file.content,
      encoding: 'utf-8',
    })
  }))

  // Create tree with the blobs
  const tree = await octokit.rest.git.createTree({
    owner: context.repo.owner,
    repo: context.repo.repo,
    base_tree: commit.data.sha,
    tree: blobs.map((blob, index) => ({
      path: filesWithMissingUUID[index].path,
      mode: '100644',
      type: 'blob',
      sha: blob.data.sha,
    })),
  })

  // Create a new commit
  const newCommit = await octokit.rest.git.createCommit({
    owner: context.repo.owner,
    repo: context.repo.repo,
    message: 'Add missing UUIDs',
    tree: tree.data.sha,
    parents: [commit.data.sha],
  })

  // Update the reference
  await octokit.rest.git.updateRef({
    owner: context.repo.owner,
    repo: context.repo.repo,
    ref: `heads/${context.ref}`,
    sha: newCommit.data.sha,
  })

  core.info(`UUIDs added to the files, commit created : ${newCommit.data.sha}`)

  // # endregion

  return filesWithMissingUUID.length > 0
}
