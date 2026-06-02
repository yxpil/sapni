/**
 * Git 工作流技能
 */
module.exports = {
  description: "标准 Git 工作流: 分支→提交→推送, 含提交信息规范和代码审查前检查",
  category: "development",
  trigger: "用户说 '提交'/'commit'/'push'/'PR' 或写完代码准备提交时使用",
  instructions: `
【提交前检查】
- 运行语法检查 (node --check / py_compile)
- 如果项目有测试，运行相关测试
- 检查是否有调试代码 (console.log / print / debugger)
- 检查是否有敏感信息 (API key / token / password)

【分支策略】
- 新功能: feature/<描述>
- Bug修复: fix/<描述>
- 重构: refactor/<描述>
- 不要直接在 main/master 上提交

【提交信息规范】
格式: <type>: <简短描述>
type: feat / fix / refactor / docs / test / chore
描述用中文或英文，动词开头，不超过 50 字
如有必要，空一行后加详细说明

【推送与 PR】
- push 前先 git pull --rebase
- 解决冲突后重新运行测试
- PR 描述写清楚: 做了什么 / 为什么 / 怎么测
`,
  workflow: [
    "检查当前分支和状态 (git status)",
    "创建功能分支 (如需要)",
    "运行语法检查和测试",
    "检查无调试代码和敏感信息",
    "git add 相关文件（不提交无关文件）",
    "按规范撰写提交信息并提交",
    "git pull --rebase 同步远程",
    "推送并汇报",
  ],
  pitfalls: [
    "绝对不提交 node_modules / .env / 编译产物",
    "不要 git add . 一把梭——逐文件确认",
    "提交信息不要写 'update' / 'fix' / '修改' 这种无意义描述",
  ],
};
