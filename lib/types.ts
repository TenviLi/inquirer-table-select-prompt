import type inquirer = require('inquirer')
import type { Key } from 'readline'
import type { TreeNode } from './filter'

export interface Row {
  name?: string
  short?: string
  value?: unknown
  row: Record<string, unknown>
  disabled?: boolean
}

export interface ResponsePagination extends Record<string, unknown> {
  currentPage?: number
  totalPages?: number
  hasPreviousPage?: boolean
  hasNextPage?: boolean
}

export interface TableSelectContext<T = Row[]> extends Record<string, unknown> {
  data?: T
  pagination?: ResponsePagination
  filters?: Record<string, unknown>
}

type AsPromise<T> = Promise<T> | T

export interface TableSelectConfig<T extends Row = Row> {
  data?: T[]

  // dataDefault?: T['value']

  source?: (answers: inquirer.Answers, context?: TableSelectContext) => AsPromise<TableSelectContext>
  tree?: TreeNode[]
  filtersDefault?: Record<string, unknown>
  tab?: TreeNode & { key: string; default?: any; children: Array<string | number | boolean> }

  loadingText?: string
  emptyText?: string

  loop?: boolean
  pageSize?: number

  prev?: (context?: TableSelectContext) => TableSelectContext | null | undefined
  next?: (context?: TableSelectContext) => TableSelectContext | null | undefined

  // pagination?: ResponsePagination
}

export enum Status {
  Loading = 'loading',
  Empty = 'empty',
  Pending = 'pending',
  Done = 'done',
}

export type KeypressEvent = {
  key: Key
  value: string
}

// export type TabChoiceList = inquirer.ExpandChoiceMap[keyof inquirer.ExpandChoiceMap][]

export interface PropsState {
  // isLoadingOnce: boolean
  isLoading: boolean
  // isFirstRender: boolean
  isToggledHelp: boolean
  selectedIndex: number
  currentTabIndex: number
}

export enum Router {
  NORMAL,
  FILTER,
}

export enum PagiDirection {
  PREV = -1,
  NEXT = 1,
}
