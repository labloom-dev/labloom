import { load, type Store } from '@tauri-apps/plugin-store'

const STORE_FILE = 'research-desk.json'

let storePromise: Promise<Store> | undefined
let operationQueue = Promise.resolve()

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation)
  operationQueue = result.then(() => undefined, () => undefined)
  return result
}

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function getStore(): Promise<Store> {
  storePromise ??= load(STORE_FILE, { autoSave: 500 })
  return storePromise
}

export async function readStoreValue<T>(key: string, fallback: T): Promise<T> {
  await operationQueue
  const store = await getStore()
  return (await store.get<T>(key)) ?? fallback
}

export function writeStoreValue<T>(key: string, value: T): Promise<void> {
  const storedValue = snapshot(value)
  return enqueue(async () => {
    const store = await getStore()
    await store.set(key, storedValue)
    await store.save()
  })
}

export function deleteStoreValue(key: string): Promise<void> {
  return enqueue(async () => {
    const store = await getStore()
    await store.delete(key)
    await store.save()
  })
}

export async function flushStore(): Promise<void> {
  await enqueue(async () => {
    const store = await getStore()
    await store.save()
  })
}
