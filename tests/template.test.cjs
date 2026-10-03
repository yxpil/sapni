'use strict';
/**
 * Tools/template_engine.js 单元测试 —— 模板列表 / 生成 / 参数校验。
 */
const test = require('node:test');
const assert = require('node:assert');
const { use_template } = require('../Tools/template_engine');

test('list：返回仓库内置模板', async () => {
  const out = await use_template.execute({ action: 'list' });
  assert.match(out, /可用模版/);
  assert.match(out, /express-api|cli-tool|test-jest/);
});

test('generate：未指定模板名 / 不存在模板 / 非法 JSON 参数均被拒绝', async () => {
  assert.match(await use_template.execute({ action: 'generate' }), /请指定模版名/);
  assert.match(await use_template.execute({ action: 'generate', name: 'no-such-template-xyz' }), /不存在/);
  assert.match(await use_template.execute({ action: 'generate', name: 'cli-tool', params: '{bad json' }), /不是合法 JSON/);
});

test('generate：未知 action 被拒绝', async () => {
  assert.match(await use_template.execute({ action: 'explode' }), /未知 action/);
});
