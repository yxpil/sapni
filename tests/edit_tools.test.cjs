'use strict';
/**
 * Tools/edit_tools.js 单元测试 —— 行级编辑/读取/范围搜索，用临时文件。
 * 边界：越界行号、未知操作、文件不存在、maxResults 截断。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { edit_lines, read_lines, search_in_range } = require('../Tools/edit_tools');

function tmpFile(content) {
  const f = path.join(os.tmpdir(), 'sapni-edit-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt');
  fs.writeFileSync(f, content, 'utf-8');
  return f;
}

test('edit_lines：insert_before/after/replace/delete 主路径', async () => {
  const f = tmpFile('line1\nline2\nline3');
  assert.match(await edit_lines.execute({ filePath: f, operation: 'insert_before', lineNumber: 2, content: 'NEW' }), /^\[OK\]/);
  assert.deepStrictEqual(fs.readFileSync(f, 'utf-8').split('\n'), ['line1', 'NEW', 'line2', 'line3']);

  assert.match(await edit_lines.execute({ filePath: f, operation: 'replace', lineNumber: 3, content: 'REPLACED' }), /^\[OK\]/);
  assert.deepStrictEqual(fs.readFileSync(f, 'utf-8').split('\n')[2], 'REPLACED');

  assert.match(await edit_lines.execute({ filePath: f, operation: 'delete', lineNumber: 2, count: 1 }), /^\[OK\]/);
  assert.deepStrictEqual(fs.readFileSync(f, 'utf-8').split('\n'), ['line1', 'REPLACED', 'line3']);
});

test('edit_lines：越界行号/未知操作/文件不存在均被拒绝，不写盘', async () => {
  const f = tmpFile('a\nb');
  assert.match(await edit_lines.execute({ filePath: f, operation: 'replace', lineNumber: 99, content: 'x' }), /越界/);
  assert.match(await edit_lines.execute({ filePath: f, operation: 'bogus', lineNumber: 1, content: 'x' }), /未知操作/);
  assert.match(await edit_lines.execute({ filePath: path.join(os.tmpdir(), 'no-such-file-xyz.txt'), operation: 'replace', lineNumber: 1, content: 'x' }), /不存在/);
  assert.deepStrictEqual(fs.readFileSync(f, 'utf-8').split('\n'), ['a', 'b'], '拒绝分支不得改动文件');
});

test('read_lines：范围读取与越界', async () => {
  const f = tmpFile('one\ntwo\nthree\nfour');
  const r = await read_lines.execute({ filePath: f, startLine: 2, endLine: 3 });
  assert.match(r, /^2\| two/m);
  assert.match(r, /^3\| three/m);
  assert.match(await read_lines.execute({ filePath: f, startLine: 99 }), /越界/);
});

test('search_in_range：匹配/忽略大小写/maxResults/无匹配', async () => {
  const f = tmpFile('Apple\nbanana\nAPPLE pie\nCherry');
  const r = await search_in_range.execute({ filePath: f, pattern: 'apple' });
  assert.match(r, /2 处匹配/);
  const caseSensitive = await search_in_range.execute({ filePath: f, pattern: 'apple', ignoreCase: false });
  assert.doesNotMatch(caseSensitive, /1\| Apple/); // 区分大小写时不匹配大写 Apple
  const none = await search_in_range.execute({ filePath: f, pattern: 'zzz-no-match' });
  assert.match(none, /无匹配/);
});
