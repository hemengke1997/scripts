import path from 'path'
import fs from 'fs-extra'
import type { BuildOptions } from 'esbuild'
import { build } from 'esbuild'
import fg from 'fast-glob'
import { getTsconfig } from 'get-tsconfig'
import { normalizePath } from './utils'

const tsconfigData = getTsconfig()

const compilerOptions = tsconfigData?.config.compilerOptions || {}

type BundleOptions = {
  entry: string
  out: string
  esbuildOptions?: BuildOptions
}

export async function bundleSingleScript(options: BundleOptions) {
  const { entry, out, esbuildOptions } = options

  const pathKeys = Object.keys(compilerOptions?.paths || {}).filter((t) => t.startsWith('@'))

  const re = new RegExp(`^(${pathKeys.join('|')})`)

  const result = await build({
    entryPoints: [entry],
    write: false,
    platform: 'node',
    bundle: true,
    format: 'esm',
    sourcemap: false,
    treeShaking: true,
    splitting: false,
    banner: {
      js: `/* eslint-disable */\n"use strict";`,
    },
    ...esbuildOptions,
    plugins: [
      {
        name: 'ts-paths',
        setup(build) {
          build.onResolve({ filter: re }, (args) => {
            const pathKey = pathKeys.find((pkey) => new RegExp(`^${pkey.replaceAll('*', '')}`).test(args.path))
            if (!pathKey) return { path: args.path }
            const [pathDir] = pathKey?.split('*')
            let file = args.path.replace(pathDir, '')
            if (file === args.path) {
              file = ''
            }

            if (!compilerOptions || !compilerOptions.paths) {
              throw new Error('Ensure `compilerOptions.paths` is defined in tsconfig.json')
            }

            for (const dir of compilerOptions.paths[pathKey]) {
              const fileDir = normalizePath(path.resolve(process.cwd(), dir).replace('*', file))
              let [matchedFile] = fg.sync(`${fileDir}.*`)
              if (!matchedFile) {
                const [matchIndexFile] = fg.sync(`${fileDir}/index.*`)
                matchedFile = matchIndexFile
              }
              if (matchedFile) {
                return { path: matchedFile }
              }
            }
            return { path: args.path }
          })
        },
      },
      {
        name: 'externalize-deps',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            const id = args.path
            if (id[0] !== '.' && !path.isAbsolute(id)) {
              return {
                external: true,
                sideEffects: false,
              }
            }
          })
        },
      },
    ],
  })
  const { text } = result.outputFiles?.[0] || { text: '' }
  const filePath = out
  if (fs.existsSync(filePath)) {
    await fs.remove(filePath)
  }
  await fs.ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, text)
}
