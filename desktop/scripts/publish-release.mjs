import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'))
const repo = process.env.GITHUB_REPO || 'yanghuide13350/huiying-studio'
const files = fs.readdirSync(path.join(desktop, 'release')).filter(f => /\.(dmg|zip|exe)$/.test(f))
if (!files.length) throw new Error('请先构建安装包')
execFileSync(process.execPath, [path.join(desktop, 'scripts/make-update-feed.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' })
execFileSync('gh', ['release', 'create', `v${pkg.version}`, '--repo', repo, '--draft', '--title', `${pkg.productName} ${pkg.version}`, '--generate-notes', ...files.map(f => path.join(desktop, 'release', f)), path.join(desktop, 'release/latest.json')], { stdio: 'inherit' })
