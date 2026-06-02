/**
 * Node.js CLI 工具模版
 */
module.exports = {
  description: "Node.js CLI 工具 (commander + chalk)",
  category: "nodejs",
  params: {
    name: "命令名, 如 'my-cli'",
    description: "CLI 描述",
    commands: "子命令, 逗号分隔, 如 'init,build'",
  },
  generate: function (params) {
    var name = params.name || "my-cli";
    var desc = params.description || "A CLI tool";
    var cmds = params.commands ? params.commands.split(",").map(function (s) { return s.trim(); }) : ["hello"];

    var lines = [
      "#!/usr/bin/env node",
      "const { program } = require('commander');",
      "const chalk = require('chalk');",
      "const fs = require('fs');",
      "const path = require('path');",
      "",
      "// ---------- 配置 ----------",
      "const pkg = require('../package.json');",
      "program",
      "  .name('" + name + "')",
      "  .description('" + desc + "')",
      "  .version(pkg.version)",
      "  .option('-v, --verbose', '详细输出');",
      "",
      "// ---------- 子命令 ----------",
    ];

    cmds.forEach(function (cmd) {
      lines.push("program");
      lines.push("  .command('" + cmd + "')");
      lines.push("  .description('" + cmd + " command')");
      lines.push("  .action(function () {");
      lines.push("    console.log(chalk.green('Running " + cmd + "...'));");
      lines.push("  });");
      lines.push("");
    });

    lines.push("// ---------- 启动 ----------");
    lines.push("program.parse(process.argv);");
    lines.push("");
    lines.push("// 无参数时显示帮助");
    lines.push("if (!process.argv.slice(2).length) {");
    lines.push("  program.outputHelp();");
    lines.push("}");

    return lines.join("\n");
  },
};
