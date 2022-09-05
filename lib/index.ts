// import ansiEscapes from 'ansi-escapes'
// const runAsync = require('run-async')
import type { Interface as ReadLineInterface } from 'readline'
import { takeWhile } from 'rxjs/operators'
import type {
  KeypressEvent,
  PropsState,
  RequestPagination,
  Row,
  SourceType,
  TabChoiceList,
  TableSelectConfig,
} from './types'
import { Status, Router } from './types'
import { chunk, generateHelpText, Shortcut } from './utils/common'
import { observeObject } from './utils/observe'
import { Paginator } from './utils/paginator'
import pc = require('picocolors')
import figures from 'figures'
import Base = require('inquirer/lib/prompts/base')
import observe = require('inquirer/lib/utils/events')
import utils = require('inquirer/lib/utils/readline')
import Table from 'easy-table'
import inquirer = require('inquirer')
import assert = require('assert')
import cliCursor = require('cli-cursor')
import memoizeOne from 'memoize-one'
import Debug from 'debug'
const debug = Debug('inquirer-table-select:index')
import { arc as dots } from 'cli-spinners'
import type ScreenManager = require('inquirer/lib/utils/screen-manager')
import { FilterPage } from './filter'

export class TableSelectPrompt extends Base<TableSelectConfig & inquirer.Question> {
  protected pageSize: number = this.opt.pageSize || 15
  protected readonly paginator = new Paginator(this.screen, {
    isInfinite: this.opt.loop === undefined ? true : this.opt.loop,
    isShowHelp: false,
  })
  protected tabChoiceKey?: string
  protected tabChoiceList?: TabChoiceList

  protected _ui: PropsState = {
    isLoading: true,
    isToggledHelp: false,
    selectedIndex: 0,
    currentTabIndex: 0,
  }
  protected ui!: PropsState
  protected pagination?: RequestPagination
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

    assert.ok(this.opt.data || this.opt.source, 'Your muse provide `data` or `source` parameter')
    if (!this.opt.source && ['sourcePrompts', 'loadingText'].some((v) => v in this.opt)) this.throwParamError('source')

    if (this.opt.sourcePrompts) {
      this.filterPage = new FilterPage(this.rl, this.screen, {
        tree: this.opt.sourcePrompts,
      })
    }

    if (this.opt.tab) {
      if (!this.opt.sourcePrompts) this.throwParamError('sourcePrompts')

      const index = this.opt.sourcePrompts!.findIndex((v) => v.name === this.opt.tab)
      if (!index) this.throwParamError('tab')
      else {
        const { name, choices } = this.opt.sourcePrompts!.splice(index, 1)[0]
        this.tabChoiceKey = name
        this.tabChoiceList = choices.filter((choice) => choice.type !== 'separator')
      }
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
      .pipe(takeWhile(() => this.router === Router.NORMAL && this.answer === undefined))
      .forEach(this.onSubmit.bind(this))
    events.keypress
      .pipe(takeWhile(() => this.router === Router.NORMAL && this.answer === undefined))
      .forEach(this.onKeypress.bind(this))
    events.keypress.pipe(takeWhile(() => this.router === Router.FILTER)).forEach(() => {})

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
    } else if (this.pagination && keyName === 'left') {
      if (this.pagination.currentPage > 1) {
        this.pagination.currentPage--
        this.fetchData()
      }
    } else if (this.pagination && keyName === 'right') {
      if (this.pagination.currentPage < this.pagination.totalPages) {
        this.pagination.currentPage++
        this.fetchData()
      }
    } else if (event.key.sequence === '/') {
      this.onRequestFilterPrompts()
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

  async onRequestFilterPrompts() {
    // TODO: 上次设置的值作为当前默认值
    // TODO: 支持快捷键的树形折叠多列表选择组件
    if (this.opt.sourcePrompts?.length) {
      const res = await inquirer.prompt(this.opt.sourcePrompts)
      const confirm = await askForApplyFilters()
      this.screen.clean(1)
      if (confirm === 'clear') {
        this.requestOpts = {}
      } else if (confirm === 'submit') {
        if (Object.keys(res).some((key) => res[key] != this.requestOpts[key])) {
          this.requestOpts = res
          await this.request()
        }
      } else if (confirm === 'cancel') {
        this.renderNormal()
      }
    }
  }

  async fetchData(payload = this.requestOpts) {
    if (this.opt.source) {
      debug('renderData::source')
      this.ui.selectedIndex = 0
      this.ui.isLoading = true
      await this.request(payload)
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

  async request(requestOpts = this.requestOpts || {}, pagination = this.pagination) {
    let thisPromise: Promise<SourceType>
    try {
      const result = this.opt.source!(this.answers, { requestOpts, pagination })
      thisPromise = Promise.resolve(result)
    } catch (error) {
      thisPromise = Promise.reject(error)
    }

    const lastPromise = thisPromise
    const { data, pagination: newPagination } = await thisPromise
    if (thisPromise !== lastPromise) return

    this.data = validateData(data)
    if (newPagination) this.pagination = newPagination
  }

  renderNormal(error?: string) {
    debug('render')
    let content = this.getQuestion()
    let lines: string[] = []
    let bottomLines: string[] = []
    const h = () => this.screen.render(content, lines.join('\n'))

    if (error) {
      lines = [`${pc.red('>> ')}${error}`]
      return h()
    }

    // Tab
    if (this.tabChoiceList?.length) lines.push(renderTab(this.tabChoiceList, this.ui.currentTabIndex))
    // Table
    if (this?.data?.length) {
      const { head, body } = renderTable(this.data, this.ui.selectedIndex)
      lines.push(pc.bgWhite(pc.bold(head[0])))

      if (this.ui.isLoading) lines.push('  ' + pc.dim(this.opt.loadingText || 'Loading...'))
      else {
        lines.push(this.paginator.paginate(body, this.ui.selectedIndex, this.pageSize))
        bottomLines.push(this.renderIndicator())
      }
      bottomLines.push(renderLine(head[1].length))
    } else {
      //   content += this.rl.line
      lines.push('  ' + pc.yellow(this.opt.emptyText || 'No results...'))
    }

    bottomLines.push('  ' + this.renderHelpText())
    lines.push(...bottomLines)

    h()
  }

  renderIndicator() {
    let res = '\n  ' + pc.dim(`Select ${this.ui.selectedIndex + 1}/${this.data.length} `)
    if (this.pagination) res += ' · ' + pc.dim(`Page ${this.pagination.currentPage}/${this.pagination.totalPages}`)
    return res
  }

  renderHelpText(isToggledHelp: boolean = this.ui.isToggledHelp) {
    const keyMap: Shortcut[] = []
    if (this.pagination) keyMap.push({ key: `←/→`, desc: 'turn pages' })
    if (this.opt.sourcePrompts) keyMap.push({ key: `/`, desc: '/' })
    if (this.opt.tab) keyMap.push({ key: `tab`, desc: 'switch tabs' })
    return generateHelpText(keyMap, isToggledHelp)
  }
}

const renderTab = memoizeOne((tabs: TabChoiceList, activeIndex: number) => {
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
      Object.entries(item.row).forEach(([key, value]) => {
        cell(key, value)
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

const askForApplyFilters = async () => {
  const { confirmApply } = await inquirer.prompt({
    default: true,
    type: 'expand',
    name: 'confirmApply',
    message: 'Confirm submitting those filters?',
    choices: [
      { key: 'y', name: 'Submit', value: 'submit' },
      { key: 'n', name: 'Cancel', value: 'cancel' },
      new inquirer.Separator(),
      { key: 'c', name: 'Clear', value: 'clear' },
    ],
  })
  return confirmApply
}

const validateData = (collection: Row[]) => {
  assert.ok(
    collection.every((row) => row.row),
    'Every data item must have a `row` property'
  )
  return collection
}

const createSpinner = async (screen: ScreenManager, message: string, func: () => Promise<void>) => {
  let spinnerIndex = 0
  const spinner = setInterval(() => {
    spinnerIndex++

    if (spinnerIndex >= dots.frames.length) {
      spinnerIndex = 0
    }

    const spinnerFrame = dots.frames[spinnerIndex]
    screen.render(pc.blue(spinnerFrame) + ' ' + message, '')
  }, dots.interval)

  await func()
  clearInterval(spinner)
  return spinner
}
