import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

interface TextFileOptions {
  title: string
  extensions: string[]
}

function filterName(extensions: string[]): string {
  return extensions.map((item) => item.toUpperCase()).join('/')
}

export async function chooseTextFile(options: TextFileOptions): Promise<string | null> {
  const path = await open({
    title: options.title,
    multiple: false,
    directory: false,
    filters: [{ name: filterName(options.extensions), extensions: options.extensions }],
  })
  if (!path) return null
  return readTextFile(path)
}

export async function saveTextFile(
  content: string,
  options: TextFileOptions & { defaultPath: string },
): Promise<boolean> {
  const path = await save({
    title: options.title,
    defaultPath: options.defaultPath,
    filters: [{ name: filterName(options.extensions), extensions: options.extensions }],
  })
  if (!path) return false
  await writeTextFile(path, content)
  return true
}
