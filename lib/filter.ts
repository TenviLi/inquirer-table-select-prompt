import figures = require('figures')
import cloneDeep = require('lodash.clonedeep')
import merge = require('lodash.merge')
import type { Interface as ReadLineInterface } from 'readline'
import type { Subscription } from 'rxjs'
import type { KeypressEvent } from './types'
import { generateHelpText, Shortcut } from './utils/common'
import Paginator from './utils/paginator'
import terminalSize = require('term-size')
import pc = require('picocolors')
import type ScreenManager = require('inquirer/lib/utils/screen-manager')
import assert = require('assert')
import observe = require('inquirer/lib/utils/events')

type AsFunction<T> = T | ((...args: any[]) => T)

export interface TreeNode<T = Normalized> {
  name?: string
  key?: string
  value?: any
  short?: string
  children?: T

  open?: boolean
  _parent?: TreeNode
  _prepared?: boolean

  _root?: TreeNode
  _isRoot?: boolean
  _selectedNode?: TreeNode[]
  [key: string]: unknown
}

type Normalized = Array<TreeNode>
type UnNormalized = AsFunction<Array<TreeNode | string> | TreeNode>

interface Options {
  pageSize?: number
  tree: UnNormalized
  filtersDefault?: any
  loop?: boolean
  message: string
  multiple?: boolean
}

export class FilterPage {
  protected isToggledHelp: boolean = false
  protected paginator: Paginator
  protected done!: Function

  protected tree!: TreeNode<Normalized>
  protected active!: TreeNode
  protected selectedList: TreeNode[] = []
  protected shownList: TreeNode[] = []

  protected subscriptions!: Subscription[]

  constructor(
    public rl: ReadLineInterface,
    public screen: ScreenManager,
    public events: ReturnType<typeof observe>,
    public opt: Options
  ) {
    this.opt = {
      pageSize: 15,
      multiple: false,
      ...this.opt,
    }
    this.paginator = new Paginator(this.screen, { isInfinite: this.opt.loop !== false })
  }

  public onKeypress(event: KeypressEvent) {
    const keyName = (event.key && event.key.name) || undefined

    if (keyName === 'h' || event.key.sequence === '?' || event.key.sequence === '？') {
      this.isToggledHelp = !this.isToggledHelp
      this.render()
    } else if (keyName === 'down' || (keyName === 'n' && event.key.ctrl)) {
      this.moveActive(1)
    } else if (keyName === 'up' || (keyName === 'p' && event.key.ctrl)) {
      this.moveActive(-1)
    } else if (keyName === 'left') {
      this.onLeftKey()
    } else if (keyName === 'right') {
      this.onRightKey()
    } else if (keyName === 'tab') {
      if (this.active.open) {
        this.onLeftKey()
      } else {
        this.onRightKey()
      }
    } else if (keyName === 'space') {
      this.toggleSelection()
    } else if (keyName === 'backspace') {
      this.tree
        .children!.filter(({ _isRoot }) => _isRoot)
        .forEach((rootNode) => {
          rootNode._selectedNode = []
        })
      this.render()
    }
  }

  onLeftKey() {
    if (this.active.children && this.active.open) {
      this.active.open = false
    } else {
      if (this.active._parent !== this.tree) {
        this.active = this.active._parent!
      }
    }

    this.render()
  }
  onRightKey() {
    if (this.active.children) {
      if (!this.active.open) {
        this.active.open = true

        prepareChildren(this.active).then(() => this.render())
      } else if (this.active.children.length) {
        this.moveActive(1)
      }
    }
  }

  public async _run(done: Function) {
    this.done = done

    const tree: TreeNode<UnNormalized> = {
      children: typeof this.opt.tree === 'function' ? this.opt.tree : cloneDeep(this.opt.tree),
    }
    await runChildrenFunctionIfRequired(tree)
    assert.ok(tree.children, new Error('Property `tree` not found children'))

    for (const node of tree.children as Normalized) {
      node._isRoot = true
      node._selectedNode = []
      // node._prepared = true
      await prepareChildren(node)
    }

    if (this.opt.filtersDefault) {
      await this.initSelections(tree as TreeNode<Normalized>)
    }

    this.tree = tree as TreeNode<Normalized>
    this.render()
  }

  subscribe(events: ReturnType<typeof observe> = this.events) {
    // const dontReset = () => this.filterPage !== null
    const subEventsLine = events.line
      // .pipe(takeWhile(dontReset))
      .subscribe(this.onSubmit.bind(this))
    const subEventsKeypress = events.keypress
      // .pipe(takeWhile(dontReset))
      .subscribe(this.onKeypress.bind(this))

    this.subscriptions = [subEventsLine, subEventsKeypress]
  }

  unsubscribe(subscriptions = this.subscriptions || []) {
    subscriptions?.forEach((sub) => sub.unsubscribe())
  }

  onSubmit(_line?: string) {
    // return this.selectedList.map((item) => valueFor(item))
    // return this.selectedList.reduce((res, node) => {
    //   let currNode: TreeNode = node
    //   let _res = {}
    //   while (node._parent) {
    //     const { key } = node._parent
    //   }
    //   return merge(res, _res)
    // }, {} as any)

    const res = {}
    this.tree.children!.forEach((rootNode) => {
      if (rootNode._selectedNode?.length) {
        merge(res, recursiveKeyify(rootNode._selectedNode))
      }
    })
    this.done(res)
  }

  render() {
    let message = this.opt.message

    this.shownList = []
    let treeContent = this.createTreeContent()
    // if (this.opt.loop !== false) {
    //   treeContent += '----------------'
    // }
    message += '\n' + this.paginator.paginate(treeContent, this.shownList.indexOf(this.active), this.opt.pageSize!)

    message += '\n' + '  ' + this.renderHelpText()

    this.screen.render(message, '')
  }

  createTreeContent(node: TreeNode = this.tree, indent = 0) {
    const children: TreeNode[] = node.children || []
    let output = ''
    children.forEach((child) => {
      this.shownList.push(child)
      if (!this.active) this.active = child

      const { open: isOpen, _isRoot: isRoot, _selectedNode } = child
      let prefix = child.children
        ? isOpen
          ? figures.arrowDown + ' '
          : figures.arrowRight + ' '
        : child === this.active
        ? figures.pointer + ' '
        : '  '
      let suffix = ' '

      if (isRoot) {
        if (_selectedNode?.length) suffix += pc.cyan(_selectedNode!.map((item) => shortFor(item)).join(', '))
        prefix += `${pc.green('?')} `
      } else {
        const rootNode = recursiveFindRootNode(child)
        // if (this.opt.multiple) {
        prefix += rootNode._selectedNode!.includes(child) ? figures.radioOn : figures.radioOff
        prefix += ' '
        // } else {
        //   prefix +=
        // }
      }

      const nameForChild = isRoot === true ? pc.bold(nameFor(child)) : nameFor(child)
      const showValue = ' '.repeat(indent) + prefix + nameForChild + suffix + '\n'

      if (child === this.active) {
        if (isRoot !== true) {
          output += pc.cyan(showValue)
        } else {
          // output += pc.red(showValue)
          output += showValue
        }
      } else {
        if (isRoot !== true) {
          output += showValue
        } else {
          output += pc.gray(showValue)
        }
      }

      if (isOpen) {
        output += this.createTreeContent(child, indent + 2)
      }
    })

    return output
  }

  moveActive(distance = 0) {
    const currentIndex = this.shownList.indexOf(this.active)
    let index = currentIndex + distance

    if (index >= this.shownList.length) {
      if (this.opt.loop === false) {
        return
      }
      index = 0
    } else if (index < 0) {
      if (this.opt.loop === false) {
        return
      }
      index = this.shownList.length - 1
    }

    this.active = this.shownList[index]

    this.render()
  }

  toggleSelection() {
    if (this.active._isRoot) {
      this.toggleOpen()
    } else {
      // const selectedIndex = this.selectedList.indexOf(this.active)
      // if (selectedIndex === -1) {
      //   this.selectedList.push(this.active)
      // } else {
      //   this.selectedList.splice(selectedIndex, 1)
      // }
      const rootNode = recursiveFindRootNode(this.active)
      const selectedIndex = rootNode._selectedNode!.indexOf(this.active)
      if (this.opt.multiple) {
        if (selectedIndex === -1) {
          rootNode._selectedNode!.push(this.active)
        } else {
          rootNode._selectedNode!.splice(selectedIndex, 1)
        }
      } else {
        if (selectedIndex === -1) {
          rootNode._selectedNode! = [this.active]
        } else {
          rootNode._selectedNode! = []
        }
      }
      this.render()
    }
  }

  toggleOpen(enforce?: boolean) {
    if (!this.active.children) {
      return
    }

    this.active.open = enforce || !this.active.open

    this.render()
  }

  renderHelpText(isToggledHelp: boolean = this.isToggledHelp) {
    const keyMap: Shortcut[] = [
      { key: 'esc', desc: 'exit' },
      { key: 'tab', desc: 'toggle' },
      { key: 'space', desc: 'select' },
      { key: 'enter', desc: 'confirm' },
      { key: 'backspace', desc: 'clear' },
    ]
    const hideKeyMap: Shortcut[] = []
    return generateHelpText({ keyMap, isToggledHelp, hideKeyMap, width: terminalSize().columns })
  }

  async initSelections(node: TreeNode<Normalized> = this.tree, def = this.opt.filtersDefault, _defPath: string = '') {
    const processedChildren =
      node?.children?.reduce((prev, child) => {
        prev[child.key!] = child
        return prev
      }, {} as Record<string, TreeNode>) || {}
    // console.log(require('util').inspect(processedChildren))

    for (const key in def) {
      const defPath = _defPath + (_defPath ? `.${key}` : key)

      if (key in processedChildren) {
        if (typeof def[key] === 'object') {
          if (Array.isArray(processedChildren[key]?.children)) {
            processedChildren[key].open = true
            await prepareChildren(processedChildren[key])
            await this.initSelections(processedChildren[key], def[key], defPath)
          } else {
            throw new Error(`Property \`tree\` key \`${defPath}\` not found children nodes`)
          }
        } else {
          processedChildren[key].open = true
          await prepareChildren(processedChildren[key])
          if (Array.isArray(processedChildren[key]?.children)) {
            const selectedChild = processedChildren[key].children!.find((child) => valueFor(child) == def[key])
            if (selectedChild) {
              const rootNode = recursiveFindRootNode(processedChildren[key])
              if (processedChildren[key]) rootNode._selectedNode!.push(selectedChild)
            } else {
              throw new Error(
                `Property \`tree\` key \`${defPath}\` children not found value ${pc.green(
                  def[key]
                )}, ${require('util').inspect(processedChildren[key].children)}`
              )
            }
          } else {
            throw new Error(`Property \`tree\` key \`${defPath}\` not found children nodes`)
          }
        }
      } else {
        // throw new Error(`Property \`tree\` not found key \`${defPath}\`` + `, ${require('util').inspect(def)}`)
        continue
      }
    }
  }
}

const runChildrenFunctionIfRequired = async (node: TreeNode<UnNormalized>) => {
  if (typeof node.children === 'function') {
    try {
      const nodeOrChildren = await node.children()

      if (nodeOrChildren) {
        let children
        if (Array.isArray(nodeOrChildren)) {
          children = nodeOrChildren
        } else {
          children = nodeOrChildren.children
          ;['name', 'value', 'short'].forEach((property) => {
            node[property] = nodeOrChildren[property]
          })
        }

        node.children = cloneDeep(children)
      }
    } catch (e) {
      //@ts-ignore
      node.children = null
    }
  }
}

const prepareChildren = async (node: TreeNode<UnNormalized>) => {
  // 无用的逻辑，仅用于标记
  if (node._prepared) return
  node._prepared = true

  // 动态使用函数生成 TreeNode[]
  await runChildrenFunctionIfRequired(node)

  // 拦截 null or undefined
  if (!node.children) return

  // Normalize
  node.children = (node.children as Array<TreeNode | string>).map((item) => {
    if (typeof item !== 'object') return { value: item }
    return item
  }) as Normalized

  await validateAndFilterDescendants(node as TreeNode<Normalized>)
}

const validateAndFilterDescendants = async (node: TreeNode<Normalized>) => {
  for (let index = node.children!.length - 1; index >= 0; index--) {
    const child = node.children![index]

    child._parent = node

    if (child.open) {
      await prepareChildren(child)
    }
  }
}

const shortFor = (node: TreeNode) => {
  return typeof node.short !== 'undefined' ? node.short : nameFor(node)
}

const nameFor = (node: TreeNode) => {
  if (typeof node.name !== 'undefined') {
    return node.name
  }

  return node.value!.toString()
}

const valueFor = (node: TreeNode) => {
  return typeof node.value !== 'undefined' ? node.value : node.name
}

const recursiveFindRootNode = (node: TreeNode) => {
  let side = node
  if (side._root) return side._root

  while (side && !side._isRoot) {
    side = side._parent!
    // if (side._root) return side._root
  }

  node._root = side
  return side
}

const recursiveKeyify = (nodes: TreeNode[]) => {
  const res = {}
  for (const node of nodes) {
    let val = valueFor(node)
    let side = node
    do {
      side = side._parent!
      val = { [side.key!]: val }
    } while (side && !side._isRoot)
    merge(res, val)
  }
  return res
}
