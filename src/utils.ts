import path from 'node:path'
import type { Context } from '@actions/github/lib/context'
import { Octokit } from '@octokit/action'
import type { PullRequestEvent } from '@octokit/webhooks-types'

export const MAX_MODIFIED_FILES = 2000

export async function getModifiedFiles(context: Context) {
  if (context.eventName !== 'pull_request')
    throw new Error('This action is not supposed to run on pull_request event')

  const payload = context.payload as PullRequestEvent

  if (payload.pull_request.changed_files > MAX_MODIFIED_FILES) {
    throw new Error(
      `Too many files changed in this PR. `
      + `When I made this tool I did not think that was `
      + `possible to have more than ${MAX_MODIFIED_FILES} files modified`,
    )
  }

  const octokit = new Octokit()

  const files = await octokit.rest.pulls.listFiles({
    ...context.repo,
    per_page: MAX_MODIFIED_FILES,
    pull_number: payload.pull_request.number,
  })

  return files.data.map(file => path.resolve(file.filename))
}
