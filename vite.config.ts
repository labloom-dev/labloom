import { createReadStream, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, type Plugin } from 'vite'

const require = createRequire(import.meta.url)
const mathjaxPluginRoot = dirname(require.resolve('@mdit/plugin-mathjax/package.json'))
// Resolve the font from the plugin so pnpm can keep the transitive package isolated.
const requireFromMathjaxPlugin = createRequire(join(mathjaxPluginRoot, 'package.json'))
const mathjaxFontRoot = dirname(
  requireFromMathjaxPlugin.resolve('@mathjax/mathjax-newcm-font/package.json'),
)
const mathjaxChtmlRoot = join(mathjaxFontRoot, 'chtml')
const mathjaxAssetDirectories = ['dynamic', 'woff2'] as const
const mathjaxPublicPrefix = '/mathjax/chtml/'

function assetFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name)
    return entry.isDirectory() ? assetFiles(file) : [file]
  })
}

function localMathjaxAssets(): Plugin {
  return {
    name: 'research-desk-local-mathjax-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let pathname: string
        try {
          pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://vite.local').pathname)
        } catch {
          next()
          return
        }

        if (!pathname.startsWith(mathjaxPublicPrefix)) {
          next()
          return
        }

        const assetPath = pathname.slice(mathjaxPublicPrefix.length)
        const directory = assetPath.split('/')[0]
        if (!mathjaxAssetDirectories.includes(directory as (typeof mathjaxAssetDirectories)[number])) {
          next()
          return
        }

        const source = resolve(mathjaxChtmlRoot, assetPath)
        if (!source.startsWith(`${resolve(mathjaxChtmlRoot)}${sep}`)) {
          next()
          return
        }

        try {
          if (!statSync(source).isFile()) {
            next()
            return
          }
        } catch {
          next()
          return
        }

        response.statusCode = 200
        response.setHeader(
          'Content-Type',
          source.endsWith('.woff2') ? 'font/woff2' : 'text/javascript; charset=utf-8',
        )
        response.setHeader('Cache-Control', 'no-cache')
        createReadStream(source).pipe(response)
      })
    },
    generateBundle() {
      for (const directory of mathjaxAssetDirectories) {
        const sourceDirectory = join(mathjaxChtmlRoot, directory)
        for (const source of assetFiles(sourceDirectory)) {
          const assetName = relative(mathjaxChtmlRoot, source).split(sep).join('/')
          this.emitFile({
            type: 'asset',
            fileName: `mathjax/chtml/${assetName}`,
            source: readFileSync(source),
          })
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), localMathjaxAssets()],
  server: {
    port: 5173,
    strictPort: true,
  },
})
