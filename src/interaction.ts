import fs from 'node:fs/promises'
import type { Context } from '@actions/github/lib/context'
import { Octokit } from '@octokit/action'
import type { PullRequestEvent } from '@octokit/webhooks-types'
import { Liquid } from 'liquidjs'
import appRoot from 'app-root-path'
import * as core from '@actions/core'
import type { BundlerResult } from './bundler'
import type { InputsParams } from './input'
import type { UploaderResult } from './uploader'
import type { Sources } from './source'

interface BundleInfo {
  path: string
  product?: string
}

interface Templates {
  'modified-bundles': {
    payload: PullRequestEvent
    added_bundles: BundleInfo[]
    modified_bundles: BundleInfo[]
    deleted_bundles: BundleInfo[]
    artifact: {
      enabled: true
      url: string
      retention_days: number
      expires_at: number
    } | {
      enabled: false
    }
    validation: {
      enabled: true
      result: 'success' | 'failure'
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

export async function parseTemplate<TemplateName extends keyof Templates>(
  name: TemplateName,
  data: Templates[TemplateName],
) {
  const templatePath = appRoot.resolve(`../templates/${name}.liquid`)
  const template = await fs.readFile(templatePath, 'utf-8')
  const engine = new Liquid()
  return (await engine.parseAndRender(template, data))
    .replace(/\n{3,}/g, '\n\n')
}

export async function updateModifiedBundleInteraction(
  params: InputsParams,
  context: Context,
  sources: Sources,
  bundler: BundlerResult,
  uploader: UploaderResult,
) {
  if (context.eventName !== 'pull_request')
    throw new Error('This action is not supposed to run on pull_request event')

  const octokit = new Octokit()
  const payload = context.payload as PullRequestEvent

  const existingComments = await getExistingCommentsPR(context)

  const existingComment = existingComments.find((comment) => {
    return comment.body?.startsWith('<!-- DDF-TOOLS-ACTION/modified-bundles -->')
  })

  const retention_days = params.upload.artifact.enabled ? params.upload.artifact.retentionDays : 0

  const body = await parseTemplate('modified-bundles', {
    added_bundles: bundler.memoryBundles
      .filter(bundle => bundle.status === 'added')
      .map(bundle => ({
        path: bundle.path.replace(params.source.path.devices, ''),
        product: bundle.bundle.data.desc.product,
      })),
    modified_bundles: bundler.memoryBundles
      .filter(bundle => bundle.status === 'modified')
      .map(bundle => ({
        path: bundle.path.replace(params.source.path.devices, ''),
        product: bundle.bundle.data.desc.product,
      })),
    deleted_bundles: sources.getUnusedFiles().ddf
      .filter(path => path.startsWith(params.source.path.devices))
      .map(path => ({
        path: path.replace(params.source.path.devices, ''),
      })),
    payload,
    artifact: {
      enabled: params.upload.artifact.enabled,
      url: `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}/artifacts/${uploader.artifact?.id}`,
      retention_days,
      expires_at: Math.floor(Date.now() / 1000) + retention_days * 24 * 60 * 60,
    },
    validation: {
      enabled: true,
      result: 'success',
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
