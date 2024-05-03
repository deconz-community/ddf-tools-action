import fs from 'node:fs/promises'
import type { Context } from '@actions/github/lib/context'
import { Octokit } from '@octokit/action'
import type { PullRequestEvent } from '@octokit/webhooks-types'
import { Liquid } from 'liquidjs'
import appRoot from 'app-root-path'
import * as core from '@actions/core'
import type { BundleData } from '@deconz-community/ddf-bundler'
import { bytesToHex } from '@noble/hashes/utils'
import type { BundlerResult } from './bundler'
import type { InputsParams } from './input'
import type { UploaderResult } from './uploader'
import type { Sources } from './source'

interface ModifiedBundleInfo {
  path: string
  product: string
  validation_emoji: string
  messages?: string[]
}

interface UploadedBundleInfo {
  path: string
  product: string
  hash: string
  store_url?: string
}

interface Templates {
  'modified-bundles': {
    payload: PullRequestEvent
    added_bundles: ModifiedBundleInfo[]
    modified_bundles: ModifiedBundleInfo[]
    deleted_bundles: Pick<ModifiedBundleInfo, 'path'>[]
    clock_emoji: string
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
      files_url: string
      detail_url: string
    } | {
      enabled: false
    }
  }
  'merged-pr': {
    payload: PullRequestEvent
    added_bundles: UploadedBundleInfo[]
    modified_bundles: UploadedBundleInfo[]
    clock_emoji: string
  }
}

const CLOCKS = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(hour => [`:clock${hour}:`, `:clock${hour}30:`]), ':duck:'].flat(5)

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

export async function updateClosedPRInteraction(
  params: InputsParams,
  context: Context,
  sources: Sources,
  bundler: BundlerResult,
) {
  if (context.eventName !== 'pull_request')
    throw new Error('This action is not supposed to run on pull_request event')

  const octokit = new Octokit()
  const payload = context.payload as PullRequestEvent

  const existingComments = await getExistingCommentsPR(context)

  const existingComment = existingComments.find((comment) => {
    return comment.body?.startsWith('<!-- DDF-TOOLS-ACTION/merged-pr -->')
  })

  bundler.memoryBundles.forEach((bundle) => {
    core.info(`bundle=${JSON.stringify(bundle.bundle.data.validation?.result)}`)
  })

  const store_url = params.upload.store.toolboxUrl

  const body = await parseTemplate('merged-pr', {
    added_bundles: bundler.memoryBundles
      .filter(bundle => bundle.status === 'added')
      .map(bundle => ({
        path: bundle.path.replace(`${params.source.path.devices}/`, ''),
        product: bundle.bundle.data.desc.product,
        hash: bytesToHex(bundle.bundle.data.hash!),
        store_url,
      })),
    modified_bundles: bundler.memoryBundles
      .filter(bundle => bundle.status === 'modified')
      .map(bundle => ({
        path: bundle.path.replace(`${params.source.path.devices}/`, ''),
        product: bundle.bundle.data.desc.product,
        hash: bytesToHex(bundle.bundle.data.hash!),
        store_url,
      })),
    payload,
    clock_emoji: CLOCKS[Math.floor(Math.random() * CLOCKS.length)],
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

  bundler.memoryBundles.forEach((bundle) => {
    core.info(`bundle=${JSON.stringify(bundle.bundle.data.validation?.result)}`)
  })

  const getResultEmoji = (result: Exclude<BundleData['validation'], undefined>['result'] | undefined) => {
    switch (result) {
      case 'success':
        return ':heavy_check_mark:'
      case 'error':
        return ':x:'
      case 'skipped':
      default:
        return ':curly_loop: (unvalidated)'
    }
  }

  const body = await parseTemplate('modified-bundles', {
    added_bundles: bundler.memoryBundles
      .filter(bundle => bundle.status === 'added')
      .map(bundle => ({
        path: bundle.path.replace(`${params.source.path.devices}/`, ''),
        product: bundle.bundle.data.desc.product,
        validation_emoji: getResultEmoji(bundle.bundle.data.validation?.result),
        messages: bundle.bundle.data.validation?.result === 'error'
          ? bundle.bundle.data.validation.errors.map(error => error.message)
          : [],
      })),
    modified_bundles: bundler.memoryBundles
      .filter(bundle => bundle.status === 'modified')
      .map(bundle => ({
        path: bundle.path.replace(`${params.source.path.devices}/`, ''),
        product: bundle.bundle.data.desc.product,
        validation_emoji: getResultEmoji(bundle.bundle.data.validation?.result),
        messages: bundle.bundle.data.validation?.result === 'error'
          ? bundle.bundle.data.validation.errors.map(error => error.message)
          : [],
      })),
    deleted_bundles: sources.getUnusedFiles().ddf
      .filter(path => path.startsWith(params.source.path.devices))
      .map(path => ({
        path: path.replace(`${params.source.path.devices}/`, ''),
      })),
    payload,
    clock_emoji: CLOCKS[Math.floor(Math.random() * CLOCKS.length)],
    artifact: {
      enabled: params.upload.artifact.enabled,
      url: `${payload.pull_request.base.repo.html_url}/actions/runs/${context.runId}/artifacts/${uploader.artifact?.id}`,
      retention_days,
      expires_at: Math.floor(Date.now() / 1000) + retention_days * 24 * 60 * 60,
    },
    validation: {
      enabled: params.bundler.enabled && params.bundler.validation.enabled,
      result: bundler.validationErrors.length === 0 ? 'success' : 'failure',
      files_url: `${payload.pull_request.base.repo.html_url}/pull/${payload.pull_request.id}/files`,
      detail_url: `${payload.pull_request.base.repo.html_url}/actions/runs/${context.runId}`,
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
