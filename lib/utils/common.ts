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
export const SEPERATOR_CHAR = ' • '
export type Shortcut = { key: string; desc: string }
type HelpTextOptions = {
  isToggledHelp?: boolean
  keyMap?: Shortcut[]
  hideKeyMap?: Shortcut[]
  width?: number
}
export function generateHelpText(options: HelpTextOptions): string {
  const { isToggledHelp = false, keyMap = [], hideKeyMap = [], width = Infinity } = options

  const finalKeyMap = []
  if (hideKeyMap.length)
    finalKeyMap.push(
      !isToggledHelp ? { key: '?', desc: 'toggle help' } : { key: pc.cyan('?'), desc: pc.cyan('toggle help') }
    )
  finalKeyMap.push(...keyMap)
  if (isToggledHelp) {
    finalKeyMap.push(...hideKeyMap)
  }

  const tempLength = [0]
  const chunks = finalKeyMap
    .map(({ key, desc }) => `${pc.gray(pc.bold(key))} ${pc.dim(desc)}`)
    // return chunk(lines, 3).map((arr) => arr.join(SEPERATOR_CHAR)).join('\n')
    // return chunks.join(SEPERATOR_CHAR)
    .reduce(
      (lines, word) => {
        const curr = lines.length - 1
        const wordLength = replaceAnsi(word).length
        if (wordLength + tempLength[curr] > width) {
          lines.push([word])
          tempLength[curr] += wordLength
        } else {
          lines[curr].push(word)
          tempLength[curr] += SEPERATOR_CHAR.length + wordLength
        }
        return lines
      },
      [[]] as string[][]
    )
    .map((words) => words.join(SEPERATOR_CHAR))

  return chunks.join('\n')
}

function replaceAnsi(str: string) {
  const ansiEscapeSequence = /\u001b.*?m/g
  return str.replace(ansiEscapeSequence, '')
}
