/**
 * React 函数组件模版 — TypeScript + Hooks
 */
module.exports = {
  description: "React 函数组件 (TypeScript + Hooks + Props)",
  category: "react",
  params: {
    name: "组件名 (PascalCase), 如 'UserCard'",
    props: "Props 定义, 如 'title:string,count:number'",
    useState: "state 变量, 逗号分隔",
    useEffect: "useEffect 依赖",
  },
  generate: function (params) {
    var name = params.name || "MyComponent";
    var propsDef = params.props || "";
    var states = params.useState ? params.useState.split(",").map(function (s) { return s.trim(); }) : [];
    var hasEffect = !!params.useEffect;
    var effectDep = params.useEffect || "";

    var lines = ["import React" + (states.length > 0 ? ", { useState" + (hasEffect ? ", useEffect" : "") + " }" : "") + " from 'react';"];

    // Props interface
    if (propsDef) {
      lines.push("");
      lines.push("interface " + name + "Props {");
      propsDef.split(",").forEach(function (p) {
        var parts = p.split(":").map(function (s) { return s.trim(); });
        lines.push("  " + parts[0] + (parts[1] ? ": " + parts[1] : ": any") + ";");
      });
      lines.push("}");
    }

    // Destructure props
    var propsKeys = propsDef ? propsDef.split(",").map(function (p) { return p.split(":")[0].trim(); }) : [];
    var propsDestruct = propsKeys.length > 0 ? "{ " + propsKeys.join(", ") + " }" : "";

    var compType = propsDef ? "React.FC<" + name + "Props>" : "React.FC";

    lines.push("");
    lines.push("export const " + name + ": " + compType + " = (" + propsDestruct + ") => {");

    // State declarations
    if (states.length > 0) {
      states.forEach(function (s) {
        var cap = s.charAt(0).toUpperCase() + s.slice(1);
        var type = s === "loading" ? "boolean" : s === "error" ? "string | null" : "any";
        lines.push("  const [" + s + ", set" + cap + "] = useState<" + type + ">(null);");
      });
    }

    // useEffect
    if (hasEffect) {
      lines.push("");
      lines.push("  useEffect(function () {");
      lines.push("    // 当 " + effectDep + " 变化时执行");
      lines.push("  }, [" + effectDep.split(",").map(function (s) { return s.trim(); }).join(", ") + "]);");
    }

    lines.push("");
    lines.push("  return (");
    lines.push("    <div className=\"" + name.toLowerCase() + "\">");
    lines.push("      {/* TODO: 组件内容 */}");
    lines.push("    </div>");
    lines.push("  );");
    lines.push("};");
    lines.push("");
    lines.push("export default " + name + ";");

    return lines.join("\n");
  },
};
