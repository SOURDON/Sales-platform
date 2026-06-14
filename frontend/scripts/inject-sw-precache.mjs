#!/usr/bin/env node
/**
 * Injects built asset URLs into dist/sw.js so the PWA shell works offline.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '../dist')
const assetsDir = path.join(distDir, 'assets')
const swPath = path.join(distDir, 'sw.js')

if (!fs.existsSync(swPath)) {
  console.warn('[inject-sw-precache] skip: dist/sw.js missing')
  process.exit(0)
}

const urls = new Set(['/index.html'])

if (fs.existsSync(assetsDir)) {
  for (const file of fs.readdirSync(assetsDir)) {
    if (file.endsWith('.js') || file.endsWith('.css') || file.endsWith('.woff2')) {
      urls.add(`/assets/${file}`)
    }
  }
}

const serialized = JSON.stringify([...urls].sort())
let sw = fs.readFileSync(swPath, 'utf8')
if (!sw.includes('/*__PRECACHE__*/[]')) {
  console.warn('[inject-sw-precache] placeholder missing in sw.js')
  process.exit(1)
}

sw = sw.replace('/*__PRECACHE__*/[]', serialized)
fs.writeFileSync(swPath, sw)
console.log(`[inject-sw-precache] ${urls.size} urls`)
