import ansiEscapes from 'ansi-escapes'
import figures from 'figures'
import Base = require('inquirer/lib/prompts/base')
import Choices = require('inquirer/lib/objects/choices')
import observe = require('inquirer/lib/utils/events')
import utils = require('inquirer/lib/utils/readline')
import Paginator = require('inquirer/lib/utils/paginator')
import ScreenManager = require('inquirer/lib/utils/screen-manager')
import pc = require('picocolors')
const runAsync = require('run-async')
import { takeWhile } from 'rxjs/operators'
import Table = require('easy-table')
import type inquirer = require('inquirer')
import type { Interface as ReadLineInterface } from 'readline'
import type { TableSelectConfig } from './interfaces/ITableSelect'

const isSelectable = (choice: { type: string; disabled: any }) => choice.type !== 'separator' && !choice.disabled

class TableSelectPrompt extends Base<TableSelectConfig & inquirer.Question> {
  protected currentChoices
  protected firstRender
  protected selected
  protected initialValue
  protected paginator = new Paginator(this.screen, {
    isInfinite: this.opt.loop === undefined ? true : this.opt.loop,
  })
  protected done!: Function
  protected answer: undefined
  protected shortAnswer: any
  protected answerName: any
  protected searching: any
  protected nbChoices: any
  protected searchedOnce: any
  protected lastSearchTerm: any

  constructor(question: inquirer.Question<inquirer.Answers>, rl: ReadLineInterface, answers: inquirer.Answers) {
    super(question, rl, answers)

    if (!this.opt.source) {
      this.throwParamError('source')
    }

    // @ts-ignore
    this.currentChoices = new Choices([])

    this.firstRender = true
    this.selected = 0

    // Make sure no default is set (so it won't be printed)
    this.initialValue = this.opt.default
    if (!this.opt.suggestOnly) {
      this.opt.default = null
    }
  }

  _run(callback: Function) {
    this.done = callback

    // @ts-ignore
    if (Array.isArray(this.rl.history)) {
      // @ts-ignore
      this.rl.history = []
    }

    const events = observe(this.rl)

    const dontHaveAnswer = () => this.answer === undefined

    events.line.pipe(takeWhile(dontHaveAnswer)).forEach(this.onSubmit.bind(this))
    events.keypress.pipe(takeWhile(dontHaveAnswer)).forEach(this.onKeypress.bind(this))

    // Call once at init
    this.search(undefined)

    return this
  }

  render(error?: string): void {
    // Render question
    let content = this.getQuestion()
    let bottomContent = ''

    if (this.firstRender) {
      const suggestText = this.opt.suggestOnly ? ', tab to autocomplete' : ''
      content += pc.dim('(Use arrow keys or type to search' + suggestText + ')')
    }

    // Render choices or answer depending on the state
    if (this.status === 'answered') {
      content += pc.cyan(this.shortAnswer || this.answerName || this.answer)
    } else if (this.searching) {
      content += this.rl.line
      bottomContent += '  ' + pc.dim(this.opt.loadingText || 'Searching...')
    } else if (this.nbChoices) {
      const choicesStr = listRender(this.currentChoices, this.selected)
      content += this.rl.line
      const indexPosition = this.selected
      let realIndexPosition = 0
      this.currentChoices.choices.every((choice, index) => {
        if (index > indexPosition) {
          return false
        }
        const name = choice.name
        realIndexPosition += name ? name.split('\n').length : 0
        return true
      })
      bottomContent += this.paginator.paginate(choicesStr, realIndexPosition, this.opt.pageSize)
    } else {
      content += this.rl.line
      bottomContent += '  ' + pc.yellow(this.opt.emptyText || 'No results...')
    }

    if (error) {
      bottomContent += '\n' + pc.red('>> ') + error
    }

    this.firstRender = false

    this.screen.render(content, bottomContent)
  }

  onSubmit(line?: string) {
    let lineOrRl = line || this.rl.line

    // only set default when suggestOnly (behaving as input prompt)
    // list prompt does only set default if matching actual item in list
    if (this.opt.suggestOnly && !lineOrRl) {
      lineOrRl = this.opt.default === null ? '' : this.opt.default
    }

    if (typeof this.opt.validate === 'function') {
      const checkValidationResult = (validationResult) => {
        if (validationResult !== true) {
          this.render(validationResult || 'Enter something, tab to autocomplete!')
        } else {
          this.onSubmitAfterValidation(lineOrRl)
        }
      }

      let validationResult
      if (this.opt.suggestOnly) {
        validationResult = this.opt.validate(lineOrRl, this.answers)
      } else {
        const choice = this.currentChoices.getChoice(this.selected)
        validationResult = this.opt.validate(choice, this.answers)
      }

      if (isPromise(validationResult)) {
        validationResult.then(checkValidationResult)
      } else {
        checkValidationResult(validationResult)
      }
    } else {
      this.onSubmitAfterValidation(lineOrRl)
    }
  }

  onSubmitAfterValidation(line /* : string */) {
    let choice = {}
    if (this.nbChoices <= this.selected && !this.opt.suggestOnly) {
      this.rl.write(line)
      this.search(line)
      return
    }

    if (this.opt.suggestOnly) {
      choice.value = line || this.rl.line
      this.answer = line || this.rl.line
      this.answerName = line || this.rl.line
      this.shortAnswer = line || this.rl.line
      this.rl.line = ''
    } else if (this.nbChoices) {
      choice = this.currentChoices.getChoice(this.selected)
      this.answer = choice.value
      this.answerName = choice.name
      this.shortAnswer = choice.short
    } else {
      this.rl.write(line)
      this.search(line)
      return
    }

    runAsync(this.opt.filter, (err, value) => {
      choice.value = value
      this.answer = value

      if (this.opt.suggestOnly) {
        this.shortAnswer = value
      }

      this.status = 'answered'
      // Rerender prompt
      this.render()
      this.screen.done()
      this.done(choice.value)
    })(choice.value)
  }

  search(searchTerm?: string): Promise<any> {
    this.selected = 0

    // Only render searching state after first time
    if (this.searchedOnce) {
      this.searching = true
      this.currentChoices = new Choices([])
      this.render() // Now render current searching state
    } else {
      this.searchedOnce = true
    }

    this.lastSearchTerm = searchTerm

    let thisPromise: Promise<any>
    try {
      const result = this.opt.source(this.answers, searchTerm)
      thisPromise = Promise.resolve(result)
    } catch (error) {
      thisPromise = Promise.reject(error)
    }

    // Store this promise for check in the callback
    const lastPromise = thisPromise

    return thisPromise.then((choices) => {
      // If another search is triggered before the current search finishes, don't set results
      if (thisPromise !== lastPromise) return

      this.currentChoices = new Choices(choices)

      const realChoices = choices.filter((choice) => isSelectable(choice))
      this.nbChoices = realChoices.length

      const selectedIndex = realChoices.findIndex(
        (choice) => choice === this.initialValue || choice.value === this.initialValue
      )

      if (selectedIndex >= 0) {
        this.selected = selectedIndex
      }

      this.searching = false
      this.render()
    })
  }

  ensureSelectedInRange() {
    const selectedIndex = Math.min(this.selected, this.nbChoices) // Not above currentChoices length - 1
    this.selected = Math.max(selectedIndex, 0) // Not below 0
  }

  /**
   * When user type
   */

  onKeypress(e /* : {key: { name: string, ctrl: boolean }, value: string } */) {
    let len
    const keyName = (e.key && e.key.name) || undefined

    if (keyName === 'tab' && this.opt.suggestOnly) {
      if (this.currentChoices.getChoice(this.selected)) {
        this.rl.write(ansiEscapes.cursorLeft)
        const autoCompleted = this.currentChoices.getChoice(this.selected).value
        this.rl.write(ansiEscapes.cursorForward(autoCompleted.length))
        this.rl.line = autoCompleted
        this.render()
      }
    } else if (keyName === 'down' || (keyName === 'n' && e.key.ctrl)) {
      len = this.nbChoices
      this.selected = this.selected < len - 1 ? this.selected + 1 : 0
      this.ensureSelectedInRange()
      this.render()
      utils.up(this.rl, 2)
    } else if (keyName === 'up' || (keyName === 'p' && e.key.ctrl)) {
      len = this.nbChoices
      this.selected = this.selected > 0 ? this.selected - 1 : len - 1
      this.ensureSelectedInRange()
      this.render()
    } else {
      this.render() // Render input automatically
      // Only search if input have actually changed, not because of other keypresses
      if (this.lastSearchTerm !== this.rl.line) {
        this.search(this.rl.line) // Trigger new search
      }
    }
  }
}

function listRender(choices: Array<any>, pointer: string): string {
  let output = ''
  let separatorOffset = 0

  choices.forEach((choice, index) => {
    if (choice.type === 'separator') {
      separatorOffset++
      output += '  ' + choice + '\n'
      return
    }

    if (choice.disabled) {
      separatorOffset++
      output += '  - ' + choice.name
      output += ' (' + (typeof choice.disabled === 'string' ? choice.disabled : 'Disabled') + ')'
      output += '\n'
      return
    }

    const isSelected = i - separatorOffset === pointer
    let line = (isSelected ? figures.pointer + ' ' : '  ') + choice.name

    if (isSelected) {
      line = pc.cyan(line)
    }

    output += line + ' \n'
  })

  return output.replace(/\n$/, '')
}

function isPromise(value: PromiseLike<any>) {
  return typeof value === 'object' && typeof value.then === 'function'
}

export = TableSelectPrompt
