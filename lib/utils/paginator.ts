'use strict'

import type ScreenManager = require('inquirer/lib/utils/screen-manager')
import * as pc from 'picocolors'

interface PaginatorOptions {
  isInfinite?: boolean
  isShowHelp?: boolean
}

export class Paginator {
  private lastIndex: number = 0
  private isInfinite?: boolean
  private isShowHelp?: boolean
  private pointer?: number

  constructor(public screen: ScreenManager, options: PaginatorOptions = {}) {
    const { isInfinite = true, isShowHelp = true } = options
    this.isInfinite = isInfinite
    this.isShowHelp = isShowHelp
  }

  paginate(output: string, active: number, pageSize: number) {
    pageSize = pageSize || 7
    let lines = output.split('\n')

    if (this.screen) {
      //@ts-ignore
      lines = this.screen.breakLines(lines)
      active = lines
        .map((lineParts) => lineParts.length)
        .splice(0, active)
        .reduce((a, b) => a + b, 0)
      lines = lines.flat()
    }

    // Make sure there's enough lines to paginate
    if (lines.length <= pageSize) {
      return output
    }
    const visibleLines = this.isInfinite
      ? this.getInfiniteLines(lines, active, pageSize)
      : this.getFiniteLines(lines, active, pageSize)
    this.lastIndex = active
    return visibleLines.join('\n') + (this.isShowHelp ? '\n' + pc.dim('(Move up and down to reveal more choices)') : '')
  }

  getInfiniteLines(lines: string | string[], active: number, pageSize: number) {
    if (this.pointer === undefined) {
      this.pointer = 0
    }
    const middleOfList = Math.floor(pageSize / 2)
    // Move the pointer only when the user go down and limit it to the middle of the list
    if (this.pointer < middleOfList && this.lastIndex < active && active - this.lastIndex < pageSize) {
      this.pointer = Math.min(middleOfList, this.pointer + active - this.lastIndex)
    }

    // Duplicate the lines so it give an infinite list look
    const infinite = [lines, lines, lines].flat()
    const topIndex = Math.max(0, active + lines.length - this.pointer)

    return infinite.splice(topIndex, pageSize)
  }

  getFiniteLines(lines: string[], active: number, pageSize: number) {
    let topIndex = active - pageSize / 2
    if (topIndex < 0) {
      topIndex = 0
    } else if (topIndex + pageSize > lines.length) {
      topIndex = lines.length - pageSize
    }
    return lines.splice(topIndex, pageSize)
  }
}

export default Paginator
