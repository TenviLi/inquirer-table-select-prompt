# inquirer-table-select-prompt

[![npm](https://badgen.net/npm/v/inquirer-table-select-prompt)](https://www.npmjs.com/package/inquirer-table-select-prompt) [![npm downloads](https://badgen.net/npm/dt/inquirer-table-select-prompt)](https://www.npmjs.com/package/inquirer-table-select-prompt)

> Table row selection prompt for [Inquirer.js](https://github.com/SBoudrias/Inquirer.js)

## 动机

现有的 inquirer.js 没有支持表格行选中的命令行交互的插件.

社区内能查找到的，只有一个二维数组的 checkbox，[eduardoboucas/inquirer-table-prompt](https://github.com/eduardoboucas/inquirer-table-prompt).

而我更需要的是类似 list/rawlist 的选中表格每一行效果.

因此我开发了一个支持表格行选中的插件，并在这个核心功能的基础上，还添加了诸如 filters, tab, filtersDefault, pagination 等丰富特性.

其中，filters 功能基于 [insightfuls/inquirer-tree-prompt](https://github.com/insightfuls/inquirer-tree-prompt) 二次开发.

## 安装

```bash
$ npm i inquirer-table-select-prompt
```

## 使用

```typescript
inquirer.registerPrompt('table-selct', require('inquirer-table-select-prompt'))
```

## 例子

查看 [examples/](https://github.com/gylidian/inquirer-table-select-prompt/blob/master/examples) 快速上手.
