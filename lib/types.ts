import type inquirer = require('inquirer')
import type { Key } from 'readline'

export interface Row {
  name?: string
  short?: string
  value?: unknown
  row: Record<string, unknown>
  disabled?: boolean
}

export type RequestPagination = { currentPage: number; totalPages: number }
export type SourceType<T = Row> = { data: T[]; pagination?: RequestPagination | null }
export type RequestConfig = { requestOpts?: any; pagination?: RequestPagination | null }

export interface TableSelectConfig<T extends Row = Row> {
  data?: T[]

  default?: T['value']

  source?: (answers: inquirer.Answers, config: RequestConfig) => Promise<SourceType<T>> | SourceType<T>
  sourcePrompts?: Array<
    inquirer.DistinctQuestion & { choices: inquirer.ExpandChoiceMap[keyof inquirer.ExpandChoiceMap][] }
  >
  tab?: string

  loadingText?: string
  emptyText?: string

  loop?: boolean
  pageSize?: number
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

export type TabChoiceList = inquirer.ExpandChoiceMap[keyof inquirer.ExpandChoiceMap][]

export interface PropsState {
  // isLoadingOnce: boolean
  isLoading: boolean
  // isFirstRender: boolean
  isToggledHelp: boolean
  selectedIndex: number
  currentTabIndex: number
  pagination?: RequestPagination | null
}
