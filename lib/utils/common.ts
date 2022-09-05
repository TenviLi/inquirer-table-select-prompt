import pc from 'picocolors'

export const chunk = <T>(arr: T[], chunkSize = 1, cache: Array<T[]> = []) => {
  const tmp = [...arr]
  if (chunkSize <= 0) return cache
  while (tmp.length) cache.push(tmp.splice(0, chunkSize))
  return cache
}

const hasOwnProperty = Object.prototype.hasOwnProperty

function is(x: any, y: any): boolean {
  if (x === y) {
    return x !== 0 || y !== 0 || 1 / x === 1 / y
  } else {
    return x !== x && y !== y
  }
}

export function isShallowEqual(objA: any, objB: any): boolean {
  if (is(objA, objB)) {
    return true
  }

  if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) {
    return false
  }

  const keysA = Object.keys(objA)
  const keysB = Object.keys(objB)

  if (keysA.length !== keysB.length) {
    return false
  }

  // Test for A's keys different from B.
  for (let i = 0; i < keysA.length; i++) {
    if (!hasOwnProperty.call(objB, keysA[i]) || !is(objA[keysA[i]], objB[keysA[i]])) {
      return false
    }
  }

  return true
}

export type Shortcut = { key: string; desc: string }
export function generateHelpText(keyMap: Shortcut[], isToggledHelp: boolean) {
  const map: Shortcut[] = []
  const stickyKeyMap = [{ key: '?', desc: 'toggle help' }]
  if (isToggledHelp) {
    map.push(...keyMap)
  }
  map.push(...stickyKeyMap)

  const lines = map.map(({ key, desc }) => `${pc.gray(key)} ${pc.dim(pc.gray(desc))}`)
  return chunk(lines, 3)
    .map((arr) => arr.join(' • '))
    .join('\n')
}
