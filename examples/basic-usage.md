# 基本使用

## 使用 `data` 提供数据

```typescript
import inquirer = require('inquirer')
import { TableSelectPrompt } from 'inquirer-table-select-prompt'
inquirer.registerPrompt('table-select', TableSelectPrompt)

inquirer
  .prompt([
    {
      type: 'table-select',
      name: 'my-table-select',
      message: '选择你的水果',
      data: [
        {
          // 必填，提交该行将会展示为 name 字段
          name: '我是美丽的🍎',
          // 必填，把每一行数据放在 row 字段下
          row: {
            图标: '🍎',
            名称: '苹果',
            学名: 'Malus domestica',
            生长地区: '在全世界广泛种植',
          },
          // 可选，指定返回的值为 'apple'
          value: 'apple',
        },
        {
          name: '我是美丽的🍌',
          row: {
            图标: '🍌',
            名称: '香蕉',
            学名: 'Musa × paradisiaca',
            生长地区: '主要分布在热带、亚热带',
          },
          // 如果你不提供 value 字段，将会默认返回 row 字段提供的值
        },
      ],
    },
  ])
  .then((v) => {
    console.log(v)
  })
```
