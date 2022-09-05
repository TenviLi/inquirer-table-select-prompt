import figures from 'figures'
import cloneDeep from 'lodash.clonedeep'
import merge from 'lodash.merge'
import type { Interface as ReadLineInterface } from 'readline'
import { KeypressEvent } from './types'
import Paginator from './utils/paginator'
import pc = require('picocolors')
import type ScreenManager = require('inquirer/lib/utils/screen-manager')
import { generateHelpText, Shortcut } from './utils/common'

type UnNormalizedChild = UnNormalizedTreeNode | string
export interface TreeNode {
  name?: string
  key?: string
  value?: unknown
  short?: string
  children: TreeNode[]

  open?: boolean
  _parent?: TreeNode
  _prepared?: boolean
  _isRoot?: boolean
  //   _root?: TreeNode
  _selectedNode: TreeNode | null

  [key: string]: unknown
}
interface RootTreeNode extends TreeNode {
  _isRoot: true
}
type UnNormalizedTreeNode = {
  children: UnNormalizedChild[]
} & TreeNode
type RawTreeNode = {
  children: UnNormalizedChild[] | ((...args: any[]) => UnNormalizedChild[])
} & TreeNode
interface Options {
  pageSize?: number
  tree: TreeNode[]
  loop?: boolean
  message: string
  multiple?: boolean
}

export class FilterPage {
  protected isToggledHelp: boolean = false
  protected paginator: Paginator

  protected tree!: { children: RootTreeNode[] }
  protected active!: TreeNode
  protected selectedList: TreeNode[] = []
  protected shownList: TreeNode[] = []
  // TODO: 每一个顶级 TreeNode 下对应子节点（单选模式）
  // TODO: 如果root节点open了：选中过的子节点的整个path上的所有父节点都open
  //   protected selectedMap: Map<TreeNode, AsArray<Omit<TreeNode, 'children'>>> = new Map()

  // TODO: 给定初始默认值，映射到 selectedList
  constructor(public rl: ReadLineInterface, public screen: ScreenManager, public opt: Options) {
    const tree = typeof this.opt.tree === 'function' ? this.opt.tree : cloneDeep(this.opt.tree)
    // TODO: 数据结构由 array 改为 object：需要按照 node.key 重新排列 this.opt.key
    this.tree = {
      children: tree.map((firstLayerNode) => ({
        ...firstLayerNode,
        _isRoot: true,
        _selectedNode: null,
        multiple: false,
      })),
    }
    this.opt = { pageSize: 15, ...this.opt }
    this.paginator = new Paginator(this.screen, { isInfinite: this.opt.loop !== false })
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
        if (this.active._parent !== this.tree) {
          this.active = this.active._parent!
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
      this.tree.children
        .filter(({ _isRoot, _selectedNode }) => _isRoot && _selectedNode)
        .forEach((rootNode) => {
          rootNode._selectedNode = null
        })
      this.render()
    } else if (keyName === 'return') {
      return this.onSubmit()
    } else if (keyName === 'escape') {
      return 0
    }
  }

  async _run() {
    await this.prepareChildrenAndRender(this.tree as RawTreeNode)
  }

  async prepareChildrenAndRender(rawNode: RawTreeNode) {
    await this.prepareChildren(rawNode)

    this.render()
  }

  async prepareChildren(node: RawTreeNode | TreeNode) {
    if (node._prepared) return
    node._prepared = true

    //@ts-ignore
    await this.runChildrenFunctionIfRequired(node)
    //@ts-ignore
    if (!node.children) return

    this.cloneAndNormaliseChildren(node)
    await this.validateAndFilterDescendants(node)
  }
  async runChildrenFunctionIfRequired(node: RawTreeNode) {
    if (typeof node.children === 'function') {
      try {
        const nodeOrChildren = await node.children()
        if (nodeOrChildren) {
          let children
          if (Array.isArray(nodeOrChildren)) {
            children = nodeOrChildren
          } else {
            //@ts-ignore
            const temp: UnNormalizedTreeNode = nodeOrChildren
            children = temp.children
            ;['name', 'value', 'short'].forEach((property) => {
              node[property] = temp[property]
            })
          }

          //@ts-ignore
          return (node.children = cloneDeep(children))
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
  }
  cloneAndNormaliseChildren(node: UnNormalizedTreeNode) {
    node.children = node.children.map((item) => {
      if (typeof item !== 'object') return { value: item } as TreeNode
      return item
    })
  }
  async validateAndFilterDescendants(node: TreeNode) {
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index]

      child._parent = node

      if (child.open) {
        await this.prepareChildren(child)
      }
    }
  }

  // TODO: 数据结构从flatten数组解析为chained对象
  onSubmit() {
    // return this.selectedList.map((item) => FilterPage.valueFor(item))
    return this.selectedList.reduce((res, node) => {
      let currNode: TreeNode = node
      let _res = {}
      while (node._parent) {
        const { key } = node._parent
      }
      return merge(res, _res)
    }, {} as any)
  }

  render() {
    let message = this.opt.message

    this.shownList = []
    let treeContent = this.createTreeContent()
    if (this.opt.loop !== false) {
      treeContent += '----------------'
    }
    message += '\n' + this.paginator.paginate(treeContent, this.shownList.indexOf(this.active), this.opt.pageSize!)

    let bottomContent = ''
    bottomContent += '  ' + this.renderHelpText()

    this.screen.render(message, bottomContent)
  }

  // TODO: 子节点选中后，其他兄弟子节点置灰处理（？）
  createTreeContent(node = this.tree, indent = 2) {
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
      let suffix = ''

      // TODO: 将答案显示在每一个 root 节点右侧
      //   if (this.opt.multiple) {

      if (isRoot) suffix += this._selectedNode.map((item) => FilterPage.shortFor(item)).join(', ')
      else {
        if (this.opt.multiple) {
          prefix += this.selectedList.includes(child) ? figures.radioOn : figures.radioOff
          prefix += ' '
        }
      }
      //   }

      const nameForChild = isRoot === true ? pc.bold(pc.gray(FilterPage.nameFor(child))) : FilterPage.nameFor(child)
      const showValue = ' '.repeat(indent) + prefix + nameForChild + '\n'

      if (child === this.active) {
        if (isRoot !== true) {
          output += pc.cyan(showValue)
        } else {
          output += pc.red(showValue)
        }
      } else {
        output += showValue
      }

      if (isOpen) {
        output += this.createTreeContent(child, indent + 2)
      }
    })

    return output
  }

  static shortFor(node: TreeNode) {
    return typeof node.short !== 'undefined' ? node.short : FilterPage.nameFor(node)
  }

  static nameFor(node: TreeNode) {
    if (typeof node.name !== 'undefined') {
      return node.name
    }

    return node.value!.toString()
  }

  static valueFor(node: TreeNode) {
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
    if (this.active._isRoot) {
      this.toggleOpen(true)
    } else {
      const selectedIndex = this.selectedList.indexOf(this.active)
      if (selectedIndex === -1) {
        this.selectedList.push(this.active)
      } else {
        this.selectedList.splice(selectedIndex, 1)
      }
    }

    this.render()
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
      { key: '←/→', desc: 'expand/collapse' },
      { key: 'space', desc: 'select' },
      { key: 'enter', desc: 'confirm' },
      { key: 'backspace', desc: 'clear' },
      { key: 'esc', desc: 'exit' },
    ]
    return generateHelpText(keyMap, isToggledHelp)
  }
}
