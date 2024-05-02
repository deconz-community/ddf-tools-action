import path from 'node:path'
import fs from 'node:fs/promises'
import type { Context } from '@actions/github/lib/context'
import { Octokit } from '@octokit/action'
import type { PullRequestEvent } from '@octokit/webhooks-types'
import { Liquid } from 'liquidjs'
import type { MemoryBundle } from './bundler'
import type { InputsParams } from './input'

interface BundleInfo {
  path: string
}

interface Templates {
  'modified-bundles': {
    pull_request: PullRequestEvent['pull_request']
    added_bundles: BundleInfo[]
    modified_bundles: BundleInfo[]
    deleted_bundles: BundleInfo[]
    artifact: {
      enabled: true
      url: string
      retention_days: number
    } | {
      enabled: false
    }
  }
}

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

export async function parseTemplate<TemplateName extends keyof Templates>(name: TemplateName, data: Templates[TemplateName]) {
  const template = await fs.readFile(path.join(__dirname, `../templates/${name}.md`), 'utf-8')
  const engine = new Liquid()
  return await engine.parseAndRender(template, data)
}

export async function updateModifiedBundleInteraction(
  params: InputsParams,
  context: Context,
  bundle: MemoryBundle[],
) {
  if (context.eventName !== 'pull_request')
    throw new Error('This action is not supposed to run on pull_request event')

  const octokit = new Octokit()
  const payload = context.payload as PullRequestEvent

  const existingComments = await getExistingCommentsPR(context)

  const existingComment = existingComments.find((comment) => {
    return comment.body?.startsWith('<!-- DDF-TOOLS-ACTION/modified-bundles -->')
  })

  const body = await parseTemplate('modified-bundles', {
    added_bundles: [{ path: 'foo' }],
    modified_bundles: [{ path: 'bar' }],
    deleted_bundles: [{ path: 'baz' }],
    pull_request: payload.pull_request,
    artifact: {
      enabled: true,
      url: 'https://example.com',
      retention_days: 5,
    },
  })

  if (existingComment !== undefined) {
    await octokit.rest.issues.updateComment({
      ...context.repo,
      comment_id: existingComment.id,
      body,
    })
  }
  else {
    octokit.rest.issues.createComment({
      ...context.repo,
      issue_number: payload.pull_request.number,
      body,
    })
  }
}
