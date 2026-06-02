/**
 * Express REST API 模版
 * 生成一个完整的 Express 服务器，含路由、中间件、错误处理
 */
module.exports = {
  description: "Express.js REST API 服务器 (含路由/中间件/错误处理)",
  category: "nodejs",
  params: {
    name: "项目名",
    port: "端口号, 默认 3000",
    routes: "路由列表, 逗号分隔, 如 'users,posts'",
  },
  generate: function (params) {
    var port = params.port || 3000;
    var routeNames = params.routes ? params.routes.split(",").map(function (s) { return s.trim(); }) : ["api"];

    var routeUses = routeNames
      .map(function (r) { return "app.use('/api/" + r + "', " + r + "Router);"; })
      .join("\n");

    var lines = [
      "const express = require('express');",
      "const cors = require('cors');",
      "const morgan = require('morgan');",
      "",
      "const app = express();",
      "const PORT = process.env.PORT || " + port + ";",
      "",
      "// ---------- 中间件 ----------",
      "app.use(cors());",
      "app.use(morgan('dev'));",
      "app.use(express.json());",
      "app.use(express.urlencoded({ extended: true }));",
      "",
      "// ---------- 路由 ----------",
      routeUses,
      "",
      "app.get('/health', (req, res) => {",
      "  res.json({ status: 'ok', uptime: process.uptime() });",
      "});",
      "",
      "// ---------- 404 ----------",
      "app.use((req, res) => {",
      "  res.status(404).json({ error: 'Not Found' });",
      "});",
      "",
      "// ---------- 全局错误处理 ----------",
      "app.use((err, req, res, next) => {",
      "  console.error('[Error]', err.message);",
      "  res.status(err.status || 500).json({",
      "    error: err.message || 'Internal Server Error',",
      "  });",
      "});",
      "",
      "// ---------- 启动 ----------",
      "if (require.main === module) {",
      "  app.listen(PORT, function () {",
      "    console.log('Server running on http://localhost:' + PORT);",
      "  });",
      "}",
      "",
      "module.exports = app;",
    ];
    return lines.join("\n");
  },
};
