/**
 * Jest 测试模版
 */
module.exports = {
  description: "Jest 测试文件 (describe/it/beforeEach)",
  category: "testing",
  params: {
    module: "被测试模块路径, 如 '../src/utils'",
    functions: "导出函数, 逗号分隔, 如 'parse,validate'",
  },
  generate: function (params) {
    var modulePath = params.module || "../src/module";
    var funcs = params.functions ? params.functions.split(",").map(function (s) { return s.trim(); }) : ["myFunction"];

    var lines = [
      "const { " + funcs.join(", ") + " } = require('" + modulePath + "');",
      "",
    ];

    funcs.forEach(function (fn) {
      lines.push("describe('" + fn + "', function () {");
      lines.push("  it('should return expected value for valid input', function () {");
      lines.push("    const result = " + fn + "(/* valid input */);");
      lines.push("    expect(result).toBeDefined();");
      lines.push("  });");
      lines.push("");
      lines.push("  it('should handle edge case: null input', function () {");
      lines.push("    expect(function () { " + fn + "(null); }).toThrow();");
      lines.push("  });");
      lines.push("");
      lines.push("  it('should handle edge case: empty input', function () {");
      lines.push("    const result = " + fn + "(/* empty input */);");
      lines.push("    // TODO: define expected behavior");
      lines.push("  });");
      lines.push("});");
      lines.push("");
    });

    return lines.join("\n");
  },
};
