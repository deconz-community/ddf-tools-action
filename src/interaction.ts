import type { Source } from '@deconz-community/ddf-bundler'
import type { Context } from '@actions/github/lib/context'
import { Octokit } from '@octokit/action'
import type { PullRequestEvent } from '@octokit/webhooks-types'
import * as core from '@actions/core'
import type { MemoryBundle } from './bundler'
import type { BundlerSourceMetadata, FileStatus } from './source'
import type { InputsParams } from './input'

export async function getExistingCommentsPR(
  context: Context,
) {
  if (context.eventName !== 'pull_request')
    throw new Error('This action is not supposed to run on pull_request event')

  const octokit = new Octokit()
  const payload = context.payload as PullRequestEvent

  const comments = await octokit.rest.issues.listComments({
    ...context.repo,
    issue_number: payload.pull_request.number,
  })

  return comments.data
    .filter((comment) => {
      return comment.user?.login === 'github-actions[bot]'
    })
}

export async function updateModifiedBundle(
  params: InputsParams,
  context: Context,
  bundle: MemoryBundle[],
) {
  if (context.eventName !== 'pull_request')
    throw new Error('This action is not supposed to run on pull_request event')

  const octokit = new Octokit()
  const payload = context.payload as PullRequestEvent

  const existingComments = await getExistingCommentsPR(context)

  const existingCommentID = existingComments.find((comment) => {
    return comment.body?.startsWith('<!-- DDF-TOOLS-ACTION/modified-bundles -->')
  })?.id

  if (existingCommentID !== undefined) {
    await octokit.rest.issues.deleteComment({
      ...context.repo,
      comment_id: existingCommentID,
    })
  }

  octokit.rest.issues.createComment({
    ...context.repo,
    issue_number: payload.pull_request.number,
    body: `<!-- DDF-TOOLS-ACTION/modified-bundles -->\n${bundle
      .map((memoryBundle) => {
        return `* ${memoryBundle.path} is ${memoryBundle.status}`
      })
      .join('\n')}`,
  })
}
