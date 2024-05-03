import { ZodError } from 'zod'
import { visit } from 'jsonc-parser'
import * as core from '@actions/core'

import type { ValidationError } from '@deconz-community/ddf-bundler'

export function handleError(error: ZodError | Error | unknown, file?: string, fileContent?: string): ValidationError[] {
  if (typeof error === 'object' && error !== null && 'errors' in error && Array.isArray(error.errors))
    return error.errors.map(error => handleError(error, file, fileContent)).flat()

  const errorsList: ValidationError[] = []

  if (error instanceof ZodError) {
    // Build error list by json path
    const errors: Record<string, string[]> = {}

    // Build a list of errors based on the path in the JSON like {'subdevices/0/type' : ['error1', 'error2']}
    error.issues.forEach((issue) => {
      const path = issue.path.join('/')
      if (Array.isArray(errors[path]))
        errors[path].push(issue.message)
      else
        errors[path] = [issue.message]
    })

    const paths = Object.keys(errors)

    // Read the JSON file to find the line and column of the error
    if (file && fileContent) {
      visit(fileContent, {
        onLiteralValue: (value: any, offset: number, length: number, line: number, column: number, pathSupplier) => {
          const pathPart = pathSupplier()
          const path = pathPart.join('/')
          const index = paths.indexOf(path)
          if (index > -1) {
            errors[path].forEach((message) => {
              errorsList.push({
                type: 'code',
                message,
                file,
                path: pathPart,
                line,
                column,
              })
            })
            paths.splice(index, 1)
          }
        },
      })
    }

    if (paths.length > 0) {
      paths.forEach((path) => {
        errors[path].forEach((message) => {
          errorsList.push({
            type: 'simple',
            message,
            file,
          })
        })
      })
    }
  }
  else if (error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)) {
    errorsList.push({
      type: 'simple',
      message: String(error.message),
      file,
    })
  }
  else if (typeof error === 'string') {
    errorsList.push({
      type: 'simple',
      message: error,
      file,
    })
  }
  else {
    errorsList.push({
      type: 'simple',
      message: 'Unknown Error',
      file,
    })
  }

  return errorsList
}

export function logsErrors(errors: ValidationError[]) {
  if (errors.length === 0)
    return

  errors.forEach((error) => {
    if (error.type === 'simple') {
      core.error(error.message)
    }
    else if (error.type === 'code') {
      core.error(error.message, {
        file: error.file,
        startLine: error.line,
        startColumn: error.column,
        title: 'Sample title',
      })
    }
  })
}
