import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'

const longTemp = realpathSync.native(tmpdir())
for (const name of ['TMPDIR', 'TMP', 'TEMP']) process.env[name] = longTemp
