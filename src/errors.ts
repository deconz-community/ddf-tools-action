import { ZodError } from 'zod'
import { visit } from 'jsonc-parser'

export type AnyError = SimpleError | ValidationError

export interface SimpleError {
  message: string
}

export type ValidationError = SimpleError & {
  file: string
  startLine?: number
  startColumn?: number
}

export function handleError(error: ZodError | Error | unknown, file: string, fileContent: string): AnyError[] {
  const errorsList: AnyError[] = []

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
    visit(fileContent, {
      onLiteralValue: (value: any, offset: number, length: number, startLine: number, startColumn: number, pathSupplier) => {
        const path = pathSupplier().join('/')
        const index = paths.indexOf(path)
        if (index > -1) {
          // core.error(`${errors[path].length} validation error${errors[path].length > 1 ? 's' : ''} in file ${filePath} at ${path}`)
          errors[path].forEach((message) => {
            errorsList.push({
              message,
              file,
              startLine,
              startColumn,
            })
            /*
            core.error(message, {
              file,
              startLine,
              startColumn,
            })
            */
          })
          paths.splice(index, 1)
        }
      },
    })

    if (paths.length > 0) {
      paths.forEach((path) => {
        errors[path].forEach((message) => {
          errorsList.push({
            message,
            file,
          })
        })
      })
    }
  }
  else if (error instanceof Error) {
    errorsList.push({
      message: error.message,
      file,
    })
  }
  else if (typeof error === 'string') {
    errorsList.push({
      message: error,
      file,
    })
  }
  else {
    errorsList.push({
      message: 'Unknown Error',
      file,
    })
  }

  return errorsList
}
