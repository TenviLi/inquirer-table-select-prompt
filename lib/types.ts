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

export type SourceType<T = Row[]> = { data: T; pagination?: ResponsePagination }

export interface TableSelectConfig<T extends Row = Row> {
  data?: T[]

  default?: T['value']

  source?: (
    answers: inquirer.Answers,
    context?: Record<string, unknown>
  ) => Promise<SourceType<Row[]>> | SourceType<Row[]>
  tree?: TreeNode[]
  treeDefault?: Object
  tab?: TreeNode

  loadingText?: string
  emptyText?: string

  loop?: boolean
  pageSize?: number

  prev?: (prevPagination: ResponsePagination) => ResponsePagination | null | undefined
  next?: (prevPagination: ResponsePagination) => ResponsePagination | null | undefined
  cache?: boolean
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
