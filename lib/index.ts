// import ansiEscapes from 'ansi-escapes'
// const runAsync = require('run-async')
// import _debounce = require('lodash.debounce')
import type { Ora } from 'ora'
import ora = require('ora')
import pc = require('picocolors')
import figures = require('figures')
import Base = require('inquirer/lib/prompts/base')
import observe = require('inquirer/lib/utils/events')
import utils = require('inquirer/lib/utils/readline')
import Paginator from './utils/paginator'
import { takeWhile } from 'rxjs/operators'
import Table = require('easy-table')
import inquirer = require('inquirer')
import assert = require('assert')
import cliCursor = require('cli-cursor')
import type { Interface as ReadLineInterface } from 'readline'
import type { KeypressEvent, Row, SourceType, PropsState, TabChoiceList, TableSelectConfig } from './types'
import { Status } from './types'
import { chunk } from './utils/common'

export class TableSelectPrompt extends Base<TableSelectConfig & inquirer.Question> {
  protected pageSize: number = this.opt.pageSize || 10
  protected spinner: Ora = ora({ text: this.opt.loadingText || 'Loading...', discardStdin: false })
  protected readonly paginator = new Paginator(this.screen, {
    isInfinite: this.opt.loop === undefined ? true : this.opt.loop,
    isShowHelp: false,
  })
  protected tabChoiceKey?: string
  protected tabChoiceList?: TabChoiceList

  protected ui: PropsState = {
    isLoadingOnce: false,
    isLoading: true,
    isFirstRender: true,
    isToggledHelp: false,
    selectedIndex: 0,
    currentTabIndex: 0,
    pagination: null,
  }
  public status = Status.Pending
  protected answer: any
  protected done!: (value: any) => void

  protected data: Row[] = []
  protected requestOpts: Record<string, unknown> = {}

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

  async request(requestOpts = this.requestOpts || {}, pagination = this.ui.pagination) {
    this.ui.isLoading = true
    this.render()

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
    if (newPagination) this.ui.pagination = newPagination
    const selectedIndex = data.findIndex((v: any) => v.value === this.opt?.default)
    this.ui.selectedIndex = selectedIndex !== -1 ? selectedIndex : 0
    this.ui.isLoading = false
    this.render()
  }

  _run(cb: (value: any) => void) {
    this.done = cb
    cliCursor.hide()

    const events = observe(this.rl)
    const dontHaveAnswer = () => this.answer === undefined
    events.line.pipe(takeWhile(dontHaveAnswer)).forEach(this.onSubmit.bind(this))
    events.keypress.pipe(takeWhile(dontHaveAnswer)).forEach(this.onKeypress.bind(this))

    this.renderData()
    return this
  }

  onKeypress(event: KeypressEvent) {
    const keyName = (event.key && event.key.name) || undefined

    if (event.key.name === 'h' || event.key.sequence === '?' || event.key.sequence === '？') {
      this.ui.isToggledHelp = !this.ui.isToggledHelp
      this.render()
    } else if (event.key.name === 'q') {
      process.exit(0)
    }
    if (this.ui.isToggledHelp) {
      return
    } else if (keyName === 'down' || (keyName === 'n' && event.key.ctrl)) {
      do {
        this.ui.selectedIndex = this.ui.selectedIndex < this.data.length - 1 ? this.ui.selectedIndex + 1 : 0
        this.ensureSelectedInRange()
      } while (!isRowSelectable(this.data[this.ui.selectedIndex]))

      this.render()
      utils.up(this.rl, 2)
    } else if (keyName === 'up' || (keyName === 'p' && event.key.ctrl)) {
      do {
        this.ui.selectedIndex = this.ui.selectedIndex > 0 ? this.ui.selectedIndex - 1 : this.data.length - 1
        this.ensureSelectedInRange()
      } while (!isRowSelectable(this.data[this.ui.selectedIndex]))

      this.render()
    } else if (this.ui.pagination && keyName === 'left') {
      if (this.ui.pagination.currentPage > 1) {
        this.ui.pagination.currentPage--
        this.renderData()
      }
    } else if (this.ui.pagination && keyName === 'right') {
      if (this.ui.pagination.currentPage < this.ui.pagination.totalPages) {
        this.ui.pagination.currentPage++
        this.renderData()
      }
    } else if (event.key.sequence === '/') {
      this.onRequestFilterPrompts()
    } else if (this.opt.tab && keyName === 'tab') {
      if (this.tabChoiceList) {
        const payload = { ...this.requestOpts, [this.tabChoiceKey!]: this.currentTabValue }
        this.renderData(payload).then(() => this.onTabSwitched())
      }
    }
  }

  ensureSelectedInRange() {
    const selectedIndex = Math.min(this.ui.selectedIndex, this.data.length) // Not above currentChoices length - 1
    this.ui.selectedIndex = Math.max(selectedIndex, 0) // Not below 0
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
    this.render()
  }

  // TODO: 上次设置的值作为当前默认值
  // TODO: 支持快捷键的树形折叠多列表选择组件
  async onRequestFilterPrompts() {
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
        this.render()
      }
    }
  }

  async renderData(payload = this.requestOpts) {
    if (this.opt.source) {
      this.ui.selectedIndex = 0

      await this.request(payload)
    } else if (this.opt.data) {
      this.data = validateData(this.opt.data)

      const selectedIndex = this.data.findIndex((row) => row.value === this.opt?.default)
      this.ui.selectedIndex = selectedIndex !== -1 ? selectedIndex : 0

      this.ui.isLoading = true
      this.render()
    }
    return
  }

  render(error?: string) {
    let content = this.getQuestion()
    let lines: string[] = []
    let bottomLines: string[] = []
    const h = () => this.screen.render(content, lines.join('\n'))

    if (!this.ui.isLoading) renderSpinner(this.spinner, this.ui.isLoading)
    if (!this.ui.isLoadingOnce && this.ui.isLoading) {
      // bottomContent += '  ' + pc.dim(this.opt.loadingText || 'Loading...')
      renderSpinner(this.spinner, this.ui.isLoading, content)
      this.ui.isLoadingOnce = true
      return h()
    }

    if (this.tabChoiceList?.length) lines.push(renderTab(this.tabChoiceList, this.ui.currentTabIndex))
    if (this?.data?.length) {
      const { head, body } = renderTable(this.data, this.ui.selectedIndex)
      lines.push(pc.bgWhite(pc.bold(head[0])))

      if (this.ui.isLoading) renderSpinner(this.spinner, this.ui.isLoading)
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

    if (error) {
      lines = [`${pc.red('>> ')}${error}`]
      h()
    }

    h()
    this.ui.isFirstRender = false
  }

  renderIndicator() {
    let res = '\n  ' + pc.dim(`Select ${this.ui.selectedIndex + 1}/${this.data.length} `)
    if (this.ui.pagination)
      res += ' · ' + pc.dim(`Page ${this.ui.pagination.currentPage}/${this.ui.pagination.totalPages}`)
    return res
  }

  renderHelpText(isToggledHelp: boolean = this.ui.isToggledHelp) {
    const stickyKeyMap = [
      { key: '?', desc: 'toggle help' },
      { key: 'q', desc: 'quit' },
    ]
    let keyMap = []
    if (isToggledHelp) {
      keyMap.push({ key: `↑/↓`, desc: 'scroll' })
      if (this.ui.pagination) keyMap.push({ key: `←/→`, desc: 'turn pages' })
      if (this.opt.sourcePrompts) keyMap.push({ key: `/`, desc: '/' })
      if (this.opt.tab) keyMap.push({ key: `tab`, desc: 'switch tabs' })
    }
    keyMap.push(...stickyKeyMap)

    // return (
    //   pc.dim('Shortcuts:\n') +
    //   Table.print(
    //     sc,
    //     (item: any, cell) => {
    //       cell('key', '  ' + pc.cyan(item.key))
    //       cell('description', '  ' + pc.dim(item.desc))
    //     },
    //     (table) => table.print()
    //   ) +
    //   '\n'
    // )

    keyMap = keyMap.map(({ key, desc }) => `${pc.gray(key)} ${pc.dim(pc.gray(desc))}`)
    return chunk(keyMap, 3)
      .map((arr) => arr.join(' • '))
      .join('\n')
  }
}

const renderTab = (tabs: TabChoiceList, activeIndex: number) => {
  const seperator = ' | '
  const res = tabs!
    .map((choice, index) => {
      //@ts-ignore
      const tabName: string = choice.short || choice.name || 'Unknown Tab'
      return activeIndex === index ? pc.bgCyan(pc.white(tabName)) : tabName
    })
    .join(seperator)
  return ' ' + res
}

const renderTable = (rowCollections: Row[], pointer: number) => {
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
}

const renderLine = (strokeSize: number) => {
  return `${'┈'.repeat(strokeSize)}`
}

const renderSpinner = (spinner: Ora, isLoading: boolean, currentText?: string) => {
  if (isLoading) {
    currentText ? spinner.start(currentText) : spinner.start()
    // process.stderr.moveCursor(0, -1)
    // process.stderr.clearLine(1)
  } else {
    // const frame = spinner.frame()
    spinner.stop()
    spinner.clear()
    // process.stderr.write(frame)
  }
}

const isRowSelectable = (row: Row) => {
  return !row.disabled
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
