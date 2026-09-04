export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait: number,
): ((...args: Args) => void) & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastArgs: Args | undefined

  const wrapped = ((...args: Args) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      const pending = lastArgs
      lastArgs = undefined
      if (pending) fn(...pending)
    }, wait)
  }) as ((...args: Args) => void) & { cancel: () => void; flush: () => void }

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    lastArgs = undefined
  }
  wrapped.flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const pending = lastArgs
    lastArgs = undefined
    if (pending) fn(...pending)
  }

  return wrapped
}
