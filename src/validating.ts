import { readFile } from 'node:fs/promises'
import * as core from '@actions/core'
import { glob } from 'glob'
import { createValidator } from '@deconz-community/ddf-validator'

import { version } from '../package.json'
import type { InputsParams } from './inputs.js'
import type { AnyError } from './errors.js'
import { handleError } from './errors.js'

export async function validate({ source, validation }: InputsParams): Promise<AnyError[]> {
  if (!source || !validation)
    throw new Error('Missing source or validation inputs')

  const errors: AnyError[] = []

  try {
    const validator = createValidator()
    const skip = false

    core.info(`Validatig DDF using GitHub action v${version} and validator v${validator.version}.`)

    // Load generic files
    let genericErrorCount = 0

    const genericDirectory = `${source.path.generic}/${source.pattern.search}`
    core.info(`Loading generic files from ${genericDirectory}`)
    const genericFilePaths = await glob(genericDirectory)

    if (genericFilePaths.length === 0)
      core.warning('No generic files found. Please check the settings.')
    else
      core.info(`Found ${genericFilePaths.length} generic files.`)

    // Load and sort generic files by schema
    const genericfiles: Record<string, { path: string, raw: string, data: unknown }[]> = {
      'constants1.schema.json': [],
      'constants2.schema.json': [],
      'resourceitem1.schema.json': [],
      'subdevice1.schema.json': [],
    }

    for (const filePath of genericFilePaths) {
      core.debug(`Loading ${filePath}.`)
      try {
        const data = await readFile(filePath, 'utf-8')
        const decoded = JSON.parse(data)

        if (skip && 'ddfvalidate' in decoded && decoded.ddfvalidate === false) {
          core.info(`Skipping file ${filePath} because it has the ddfvalidate option set to false`)
          continue
        }

        if (typeof decoded.schema === 'string' || genericfiles[decoded.schema] === undefined) {
          genericfiles[decoded.schema].push({
            path: filePath,
            raw: data,
            data: decoded,
          })
        }
        else { core.error(`${filePath}:Unknown schema ${decoded.schema}`) }
      }
      catch (error) {
        genericErrorCount++
        if (error instanceof Error)
          core.error(`${filePath}: ${error.message}`)
        else
          core.error(`${filePath}: Unknown Error`)
      }
    }

    // Validating files
    for (const [domain, files] of Object.entries(genericfiles)) {
      core.info(`Loading ${genericfiles[domain].length} files with schema "${domain}".`)
      for (const file of files) {
        core.debug(`Validating ${file.path}...`)
        try {
          validator.loadGeneric(file.data)
          core.debug(`Validating ${file.path}. OK`)
        }
        catch (error) {
          genericErrorCount++
          handleError(error, file.path, file.raw)
        }
      }
    }

    core.info(`Loaded ${genericFilePaths.length - genericErrorCount} files.`)
    if (genericErrorCount > 0)
      core.warning(`${genericErrorCount} files was not loaded because of errors.`)

    // Validate DDF files
    let ddfErrorCount = 0
    const ddfDirectory = `${core.getInput('directory')}/${core.getInput('search')}`

    const ignoreLog = core.getInput('ignore') ? ` (ignore: ${core.getInput('ignore')})` : ''
    core.info(`Validating DDF files from ${ddfDirectory}${ignoreLog}`)

    const inputFiles = await glob(ddfDirectory, {
      ignore: core.getInput('ignore'),
    })

    if (inputFiles.length === 0)
      throw new Error('No files found. Please check the settings.')

    core.info(`Found ${inputFiles.length} files to valiate.`)

    for (const filePath of inputFiles) {
      let data = ''
      try {
        data = await readFile(filePath, 'utf-8')
        const decoded = JSON.parse(data)

        if (skip && 'ddfvalidate' in decoded && decoded.ddfvalidate === false) {
          core.info(`Skipping file ${filePath} because it has the ddfvalidate option set to false`)
          continue
        }

        validator.validate(decoded)
      }
      catch (error) {
        ddfErrorCount++
        handleError(error, filePath, data)
      }
    }

    if ((genericErrorCount + ddfErrorCount) > 0)
      core.setFailed(`Found ${genericErrorCount + ddfErrorCount} invalid files. Check logs for details.`)
    else
      core.info('All files passed.')
  }
  catch (error) {
    if (error instanceof Error)
      core.setFailed(error.message)
  }

  return errors
}
