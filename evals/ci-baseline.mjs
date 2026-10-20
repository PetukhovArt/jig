import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const norm = (path) => path.replaceAll('\\', '/')

const relativeTo = (root, path) => {
  const file = norm(path).replace(/^(\.\.\/)+/, '')
  const prefix = `${norm(root).replace(/\/$/, '')}/`
  return file.toLowerCase().startsWith(prefix.toLowerCase()) ? file.slice(prefix.length) : file
}

const parseTsc = (output, root) =>
  output
    .split('\n')
    .map((line) => /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map(([, file, line, column, code, message]) => ({ file: relativeTo(root, file), line: Number(line), column: Number(column), code, message: message.trim() }))

const parseEslint = (report, root) =>
  report.flatMap((entry) =>
    entry.messages
      .filter((message) => message.severity === 2)
      .map((message) => ({ file: relativeTo(root, entry.filePath), line: message.line ?? 0, column: message.column ?? 0, code: message.ruleId ?? '', message: message.message })),
  )

const errorKey = (error) => `${error.file}\0${error.code}\0${error.message}`

const newErrors = (errors, baseErrors, isChanged) => {
  const allowance = new Map()
  for (const error of baseErrors) allowance.set(errorKey(error), (allowance.get(errorKey(error)) ?? 0) + 1)
  const explained = (error) => {
    const left = allowance.get(errorKey(error)) ?? 0
    if (left === 0) return false
    allowance.set(errorKey(error), left - 1)
    return true
  }
  for (const error of errors) if (!isChanged(error)) explained(error)
  return errors.filter(isChanged).filter((error) => !explained(error))
}

const cachedBaseErrors = (baseRoot, tool, files, check) => {
  const dir = join(baseRoot, '.git', 'jig-ci-cache')
  const key = createHash('sha1').update(JSON.stringify([tool, [...files].sort()])).digest('hex').slice(0, 16)
  const path = join(dir, `${tool}-${key}.json`)
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'))
  const errors = check()
  mkdirSync(dir, { recursive: true })
  const partial = `${path}.${process.pid}`
  writeFileSync(partial, JSON.stringify(errors))
  renameSync(partial, path)
  return errors
}

export { cachedBaseErrors, errorKey, newErrors, parseEslint, parseTsc }
