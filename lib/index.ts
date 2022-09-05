// import ansiEscapes from 'ansi-escapes'
// const runAsync = require('run-async')
import { arc as dots } from 'cli-spinners'
import Debug from 'debug'
import Table from 'easy-table'
import figures from 'figures'
import isPlainObject from 'lodash.isplainobject'
import memoizeOne from 'memoize-one'
import type { Interface as ReadLineInterface } from 'readline'
import { takeWhile } from 'rxjs/operators'
import type { TreeNode } from './filter'
import { FilterPage } from './filter'
import type { KeypressEvent, PropsState, ResponsePagination, Row, SourceType, TableSelectConfig } from './types'
import { Router, Status } from './types'
import { generateHelpText, SEPERATOR_CHAR, Shortcut } from './utils/common'
import { observeObject } from './utils/observe'
import { Paginator } from './utils/paginator'
import pc = require('picocolors')
import Base = require('inquirer/lib/prompts/base')
import observe = require('inquirer/lib/utils/events')
import utils = require('inquirer/lib/utils/readline')
import inquirer = require('inquirer')
import assert = require('assert')
import cliCursor = require('cli-cursor')
const debug = Debug('inquirer-table-select:index')
import type ScreenManager = require('inquirer/lib/utils/screen-manager')
import merge = require('lodash.merge')

// TODO: inquirer 的各种方法 支持 async，支持各种字段比如 filter transformer 等
export class TableSelectPrompt extends Base<TableSelectConfig & inquirer.Question> {
  protected pageSize: number = this.opt.pageSize || 15
  protected readonly paginator = new Paginator(this.screen, {
    isInfinite: this.opt.loop === undefined ? true : this.opt.loop,
    isShowHelp: false,
  })
  protected tabChoiceKey?: string
  protected tabChoiceList?: TreeNode[]

  protected _ui: PropsState = {
    isLoading: true,
    isToggledHelp: false,
    selectedIndex: 0,
    currentTabIndex: 0,
  }
  protected ui!: PropsState
  protected pagination?: ResponsePagination
  public status = Status.Pending
  protected answer: any
  protected done!: (value: any) => void

  protected data: Row[] = []

  protected requestOpts: Record<string, unknown> = {}
  protected router: Router = Router.NORMAL
  protected filterPage?: FilterPage

  get currentTabValue() {
    //@ts-ignore
    return this.tabChoiceList![this.ui.currentTabIndex].value
  }

  get currentRow() {
    return this.data[this.ui.selectedIndex]
  }

  constructor(question: inquirer.Question<inquirer.Answers>, rl: ReadLineInterface, answers: inquirer.Answers) {
    super(question, rl, answers)
    const { data, source, tree, tab } = this.opt

    this.opt.default = null // 禁用默认渲染行为

    assert.ok(data || source, 'Your muse provide `data` or `source` parameter')
    if (!source && ['tree', 'loadingText'].some((v) => v in this.opt)) this.throwParamError('source')

    if (tree) {
      this.filterPage = new FilterPage(this.rl, this.screen, {
        tree,
        message: `${this.getQuestion()}
  Filters:
`,
      })
    }

    if (tab) {
      const { children, key } = tab
      this.tabChoiceKey = key
      this.tabChoiceList = children
    }
  }

  render() {
    if (this.router === Router.NORMAL) {
      this.renderNormal()
    }
  }

  async _run(cb: (value: any) => void) {
    this.done = cb
    cliCursor.hide()

    const [observedObject, observedObjectChange$] = observeObject(this._ui)
    this.ui = observedObject

    await createSpinner(this.screen, this.getQuestion().replace(`${pc.green('?')} `, ''), async () => {
      await this.fetchData()
    })

    debug('_run')
    this.renderNormal()

    observedObjectChange$.subscribe((changes: any) => {
      debug(changes)
      this.renderNormal()
    })

    const events = observe(this.rl)
    // const dontHaveAnswer = () => this.answer === undefined
    events.line
      .pipe(takeWhile(() => this.router === Router.NORMAL && this.answer === undefined && this._ui.isLoading !== false))
      .forEach(this.onSubmit.bind(this))
    events.keypress
      .pipe(takeWhile(() => this.router === Router.NORMAL && this.answer === undefined && this._ui.isLoading !== false))
      .forEach(this.onKeypress.bind(this))
    events.keypress
      .pipe(takeWhile(() => this.router === Router.FILTER && !this.filterPage))
      .forEach(this.filterPage!.onKeypress.bind(this.filterPage!))

    return this
  }

  onKeypress(event: KeypressEvent) {
    const keyName = (event.key && event.key.name) || undefined

    if (event.key.name === 'q') process.exit(0)

    // if (this.ui.isToggledHelp) return
    if (keyName === 'h' || event.key.sequence === '?' || event.key.sequence === '？') {
      this.ui.isToggledHelp = !this.ui.isToggledHelp
    } else if (keyName === 'down' || (keyName === 'n' && event.key.ctrl)) {
      let index = this.ui.selectedIndex
      do {
        index = index < this.data.length - 1 ? index + 1 : 0
      } while (!isRowSelectable(this.data[index]))
      this.ui.selectedIndex = index
      utils.up(this.rl, 2)
    } else if (keyName === 'up' || (keyName === 'p' && event.key.ctrl)) {
      let index = this.ui.selectedIndex
      do {
        index = index > 0 ? index - 1 : this.data.length - 1
      } while (!isRowSelectable(this.data[index]))
      this.ui.selectedIndex = index
    } else if (this.pagination?.hasPreviousPage && this.opt.prev && keyName === 'left') {
      this.opt.prev?.(this.requestOpts)
      this.fetchData()
    } else if (this.pagination?.hasNextPage && this.opt.next && keyName === 'right') {
      this.opt.next?.(this.requestOpts)
      this.fetchData()
    } else if (this.opt.tree && event.key.sequence === '/' && keyName === 'f') {
      this.router = Router.FILTER
      this.filterPage?._run((options: any) => {
        this.filterPage = undefined
        merge(this.requestOpts, options)
        this.router = Router.NORMAL
        this.renderNormal()
      })
    } else if (this.opt.tab && keyName === 'tab') {
      if (this.tabChoiceList) {
        const payload = { ...this.requestOpts, [this.tabChoiceKey!]: this.currentTabValue }
        this.request(payload).then(() => this.onTabSwitched())
      }
    }
  }

  onSubmit(_line?: string) {
    this.status = Status.Done
    this.answer = (this.currentRow.short || this.currentRow.name || this.currentRow.value) ?? this.currentRow.row
    this.screen.render(`${this.getQuestion()}${pc.cyan(this.answer)}`, '')

    this.screen.done()
    cliCursor.show()

    this.done(this.currentRow.value ?? this.currentRow.row)
  }

  async onTabSwitched() {
    this.ui.currentTabIndex = this.ui.currentTabIndex++ % this.tabChoiceList!.length
  }

  async fetchData(payload = this.requestOpts) {
    if (this.opt.source) {
      debug('renderData::source')
      this.ui.selectedIndex = 0
      this.ui.isLoading = true
      // await createSpinner(
      //   this.screen,
      //   this.getQuestion().replace(`${pc.green('?')} `, ''),
      //   async () => {
      await this.request(payload)
      //   },
      //   this.opt.loadingText
      // )
      const selectedIndex = this.data.findIndex((v: any) => v.value === this.opt?.default)
      this.ui.selectedIndex = selectedIndex !== -1 ? selectedIndex : 0
      this.ui.isLoading = false
    } else if (this.opt.data) {
      debug('fetchData start')
      this.ui.isLoading = true
      this.data = validateData(this.opt.data)
      const selectedIndex = this.data.findIndex((row) => row.value === this.opt?.default)
      this.ui.selectedIndex = selectedIndex !== -1 ? selectedIndex : 0
      this.ui.isLoading = false
      debug('fetchData end')
    }
  }

  async request(requestOpts = this.requestOpts || {}) {
    let thisPromise: Promise<SourceType>
    try {
      const result = this.opt.source!(this.answers, { requestOpts })
      thisPromise = Promise.resolve(result)
    } catch (error) {
      thisPromise = Promise.reject(error)
    }

    const lastPromise = thisPromise
    const res = await thisPromise
    assert.ok(isPlainObject(res), new Error('`Source` method need to return a plain object'))
    const { data, pagination: newPagination } = res
    assert.ok(Array.isArray(data), new Error('`Source` method need to return { data: Row[] }'))
    if (thisPromise !== lastPromise) return

    this.data = validateData(data)
    if (newPagination) this.pagination = newPagination
  }

  renderNormal(error?: string) {
    debug('render')
    let content = this.getQuestion()
    let lines: string[] = []
    let bottomLines: string[] = []

    if (error) {
      lines = [`${pc.red('>> ')}${error}`]
      return this.screen.render(content, lines.join('\n'))
    }

    // Tab
    if (this.tabChoiceList?.length) lines.push(renderTab(this.tabChoiceList, this.ui.currentTabIndex))
    // Table
    if (this?.data?.length) {
      const { head, body } = renderTable(this.data, this.ui.selectedIndex)
      lines.push(pc.bgWhite(pc.bold(head[0])))
      const len = head[1].length

      if (this.ui.isLoading) lines.push('  ' + pc.dim(this.opt.loadingText || 'Loading...'))
      else {
        lines.push(this.paginator.paginate(body, this.ui.selectedIndex, this.pageSize))
        bottomLines.push(this.renderIndicator(len))
      }
      bottomLines.push(renderLine(len))
    } else {
      //   content += this.rl.line
      lines.push('  ' + pc.yellow(this.opt.emptyText || 'No results...'))
    }

    bottomLines.push('  ' + this.renderHelpText())
    lines.push(...bottomLines)

    this.screen.render(content, lines.join('\n'))
  }

  renderIndicator(limitSize: number) {
    let left = '  ' + `Select ${this.ui.selectedIndex + 1}/${this.data.length}`
    let right = ''
    if (this.pagination) {
      const { currentPage, totalPages, hasNextPage, hasPreviousPage } = this.pagination
      if (currentPage && totalPages)
        left += SEPERATOR_CHAR + `Page ${this.pagination.currentPage}/${this.pagination.totalPages}`

      const rightChunk = []
      hasPreviousPage && rightChunk.push(`← prev`)
      hasNextPage && rightChunk.push(`next →`)

      if (rightChunk.length) {
        right = rightChunk.join(SEPERATOR_CHAR)

        const spaceLen = limitSize - left.length - 2
        if (spaceLen > SEPERATOR_CHAR.length) {
          right = right.padStart(spaceLen, ' ').replace(right, rightChunk.map(pc.bold).join(SEPERATOR_CHAR))
        } else {
          right = pc.white(SEPERATOR_CHAR) + right
        }
      }
    }
    return '\n' + pc.dim(left) + pc.gray(right)
  }

  renderHelpText(isToggledHelp: boolean = this.ui.isToggledHelp) {
    const keyMap: Shortcut[] = [
      { key: 'q', desc: 'quit' },
      { key: `enter`, desc: 'submit' },
      { key: `↑/↓`, desc: 'scroll' },
    ]
    if (this.pagination) keyMap.push({ key: `←/→`, desc: 'turn pages' })
    if (this.opt.tree) keyMap.push({ key: `/`, desc: '/' })
    if (this.opt.tab) keyMap.push({ key: `tab`, desc: 'switch tabs' })
    return generateHelpText(keyMap, isToggledHelp)
  }
}

const renderTab = memoizeOne((tabs: TreeNode[], activeIndex: number) => {
  const seperator = ' | '
  const res = tabs!
    .map((choice, index) => {
      //@ts-ignore
      const tabName: string = choice.short || choice.name || 'Unknown Tab'
      return activeIndex === index ? pc.bgCyan(pc.white(tabName)) : tabName
    })
    .join(seperator)
  return ' ' + res
})

const renderTable = memoizeOne((rowCollections: Row[], pointer: number) => {
  const text = Table.print(
    rowCollections,
    (item, cell) => {
      const entries = Object.entries(item.row)
      entries.forEach(([key, value], index) => {
        if (index === entries.length - 1) return cell(`${key}  `, value)
        return cell(key, value)
      })
    },
    (table) => {
      return table.toString().replace(/\n$/, '')
    }
  ).split('\n')

  const res = {
    head: text.slice(0, 2).map((str) => `  ${str}`),
    body: text
      .slice(2)
      .map((rowStr, i) => {
        if (!isRowSelectable(rowCollections[i])) {
          return `  ${pc.dim(rowStr)}`
        }
        const isSelected = i === pointer
        return isSelected ? `${pc.cyan(figures.pointer)} ${pc.cyan(rowStr)}` : `  ${rowStr}`
      })
      .join('\n'),
  }

  return res
})

const renderLine = memoizeOne((strokeSize: number) => {
  return `${'┈'.repeat(strokeSize)}`
})

const isRowSelectable = (row: Row) => {
  return row && !row.disabled
}

const validateData = (collection: Row[]) => {
  assert.ok(
    collection.every((row) => row.row),
    'Every data item must have a `row` property'
  )
  return collection
}

const createSpinner = async (
  screen: ScreenManager,
  message: string,
  func: () => Promise<void>,
  loadingText?: string
) => {
  let spinnerIndex = 0
  const spinner = setInterval(() => {
    spinnerIndex++

    if (spinnerIndex >= dots.frames.length) {
      spinnerIndex = 0
    }

    const spinnerFrame = dots.frames[spinnerIndex]
    screen.render(
      `${pc.blue(spinnerFrame)} ${message}
  ${pc.dim(loadingText || 'Loading...')}`,
      ''
    )
  }, dots.interval)

  await func()
  clearInterval(spinner)
  return spinner
}
