import { spawnSync } from 'node:child_process'

const inRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).stdout.trim() === 'true'
if (inRepo && process.env['CI'] === undefined) spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' })
