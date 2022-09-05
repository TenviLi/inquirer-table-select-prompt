import figures from 'figures'
import cloneDeep from 'lodash.clonedeep'
import type { Interface as ReadLineInterface } from 'readline'
import { KeypressEvent } from './types'
import Paginator from './utils/paginator'
import pc = require('picocolors')
import type ScreenManager = require('inquirer/lib/utils/screen-manager')
import { generateHelpText, Shortcut } from './utils/common'

type TreeNodeFunction = (...args: any[]) => TreeNode[]
interface TreeNode {
  name?: string
  value?: any
  short?: string
  open?: boolean
  children: TreeNode[] | TreeNodeFunction

  parent?: TreeNode
  prepared?: boolean
  [key: string]: unknown
}
interface ProcessedTreeNode extends TreeNode {
  children: TreeNode[]
}
interface Options {
  pageSize?: number
  tree: TreeNode[]
  loop?: boolean
  message: string
}

export class FilterPage {
  firstRender: boolean = true
  tree: TreeNode
  shownList: any[] = []
  paginator: any
  selectedList: any[] = []
  active!: TreeNode
  status?: string
  isToggledHelp: boolean = false

  constructor(public rl: ReadLineInterface, public screen: ScreenManager, public opt: Options) {
    const tree = typeof this.opt.tree === 'function' ? this.opt.tree : cloneDeep(this.opt.tree)
    this.tree = { children: tree }

    this.opt = {
      pageSize: 15,
      ...this.opt,
    }

    this.paginator = new Paginator(this.screen, { isInfinite: this.opt.loop !== false })
  }

  async _run() {
    await this.prepareChildrenAndRender(this.tree)
  }

  async prepareChildrenAndRender(node: TreeNode) {
    await this.prepareChildren(node)

    this.render()
  }

  async prepareChildren(node: TreeNode | ProcessedTreeNode) {
    if (node.prepared) {
      return
    }
    node.prepared = true

    const isProcessedTreeNode = await this.runChildrenFunctionIfRequired(node)

    if (!node.children) {
      return
    }

    if (isProcessedTreeNode(node)) {
      this.cloneAndNormaliseChildren(node)

      await this.validateAndFilterDescendants(node)
    }
  }

  async runChildrenFunctionIfRequired(node: TreeNode): Promise<(node: any) => node is ProcessedTreeNode> {
    if (typeof node.children === 'function') {
      try {
        const nodeOrChildren = (await node.children()) as TreeNode[] | TreeNode
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
        /*
         * if something goes wrong gathering the children, ignore it;
         * it could be something like permission denied for a single
         * directory in a file hierarchy
         */

        //@ts-ignore
        node.children = null
      }
    }
    return (_node): _node is ProcessedTreeNode => true
  }

  cloneAndNormaliseChildren(node: ProcessedTreeNode) {
    node.children = node.children.map((item: any) => {
      if (typeof item !== 'object') {
        return {
          value: item,
        }
      }

      return item
    })
  }

  async validateAndFilterDescendants(node: ProcessedTreeNode) {
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index]

      child.parent = node

      if (child.open) {
        await this.prepareChildren(child)
      }
    }
  }

  done() {
    // this.status = 'answered'

    // this.render()

    // this.screen.done()

    return this.selectedList.map((item) => this.valueFor(item))
  }

  onKeypress(event: KeypressEvent) {
    const keyName = (event.key && event.key.name) || undefined

    if (keyName === 'h' || event.key.sequence === '?' || event.key.sequence === '？') {
      this.isToggledHelp = !this.isToggledHelp
    } else if (keyName === 'down' || (keyName === 'n' && event.key.ctrl)) {
      this.moveActive(1)
    } else if (keyName === 'up' || (keyName === 'p' && event.key.ctrl)) {
      this.moveActive(-1)
    } else if (keyName === 'left') {
      if (this.active.children && this.active.open) {
        this.active.open = false
      } else {
        if (this.active.parent !== this.tree) {
          this.active = this.active.parent!
        }
      }

      this.render()
    } else if (keyName === 'right') {
      if (this.active.children) {
        if (!this.active.open) {
          this.active.open = true

          this.prepareChildrenAndRender(this.active)
        } else if (this.active.children.length) {
          this.moveActive(1)
        }
      }
    } else if (keyName === 'right') {
      this.toggleOpen()
    } else if (keyName === 'space') {
      this.toggleSelection()
    } else if (keyName === 'backspace') {
      this.selectedList = []
      this.render()
    } else if (keyName === 'return') {
      return this.done()
    } else if (keyName === 'escape') {
      return 0
    }
  }
  render() {
    let message = this.opt.message

    this.shownList = []
    let treeContent = this.createTreeContent()
    if (this.opt.loop !== false) {
      treeContent += '----------------'
    }
    message += '\n' + this.paginator.paginate(treeContent, this.shownList.indexOf(this.active), this.opt.pageSize)

    let bottomContent = ''
    bottomContent += '  ' + this.renderHelpText()

    this.screen.render(message, bottomContent)
  }

  createTreeContent(node = this.tree, indent = 2) {
    const children: TreeNode[] = (node.children as TreeNode[]) || []
    let output = ''

    children.forEach((child) => {
      this.shownList.push(child)
      if (!this.active) {
        this.active = child
      }

      let prefix = child.children
        ? child.open
          ? figures.arrowDown + ' '
          : figures.arrowRight + ' '
        : child === this.active
        ? figures.pointer + ' '
        : '  '

      //   if (this.opt.multiple) {
      prefix += this.selectedList.includes(child) ? figures.radioOn : figures.radioOff
      prefix += ' '
      //   }

      const showValue = ' '.repeat(indent) + prefix + this.nameFor(child) + '\n'

      if (child === this.active) {
        if (child.isValid === true) {
          output += pc.cyan(showValue)
        }
      } else {
        output += showValue
      }

      if (child.open) {
        output += this.createTreeContent(child, indent + 2)
      }
    })

    return output
  }

  shortFor(node: TreeNode) {
    return typeof node.short !== 'undefined' ? node.short : this.nameFor(node)
  }

  nameFor(node: TreeNode) {
    if (typeof node.name !== 'undefined') {
      return node.name
    }

    return node.value
  }

  valueFor(node: TreeNode) {
    return typeof node.value !== 'undefined' ? node.value : node.name
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
    if (this.active.isValid !== true) {
      return
    }

    const selectedIndex = this.selectedList.indexOf(this.active)
    if (selectedIndex === -1) {
      this.selectedList.push(this.active)
    } else {
      this.selectedList.splice(selectedIndex, 1)
    }

    this.render()
  }

  toggleOpen() {
    if (!this.active.children) {
      return
    }

    this.active.open = !this.active.open

    this.render()
  }

  renderHelpText(isToggledHelp: boolean = this.isToggledHelp) {
    const keyMap: Shortcut[] = [
      { key: 'space', desc: 'select' },
      { key: 'enter', desc: 'confirm' },
      { key: 'backspace', desc: 'clear' },
      { key: 'esc', desc: 'exit' },
    ]
    return generateHelpText(keyMap, isToggledHelp)
  }
}
