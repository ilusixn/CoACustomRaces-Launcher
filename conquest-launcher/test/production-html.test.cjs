const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { productionHtml } = require('../tools/production-bundles.cjs');

test('packaged HTML loads protected renderer once and retains the independent builder data', async () => {
  const source = await fs.readFile(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(source, /<script src="auth-gate.js"><\/script>/);
  for (const html of [source, source.replaceAll('\r\n', '\n')]) {
    const result = productionHtml(html);
    assert.deepEqual([...result.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]), ['builder/data/coa-data.js', 'c.js']);
    assert.match(result, /script-src 'self'/);
  }
});
