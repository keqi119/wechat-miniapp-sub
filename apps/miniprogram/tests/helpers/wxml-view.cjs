const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Evaluate the declarative visibility/text subset used by these page regression tests.
// Native layout and template compilation are checked by the package compiler separately.
function renderPage(name, data) {
  const root = { children: [] }, stack = [root];
  const source = fs.readFileSync(path.join(__dirname, '../../src/pages', name, 'index.wxml'), 'utf8');
  for (const token of source.match(/<!--[\s\S]*?-->|<\/?[\w:-]+(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/g) || []) {
    if (token.startsWith('<!--')) continue;
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (!token.startsWith('<')) { stack.at(-1).children.push(token); continue; }
    const node = { tag: token.match(/^<([\w:-]+)/)[1], attrs: {}, children: [] };
    for (const match of token.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) node.attrs[match[1]] = match[2] ?? '';
    stack.at(-1).children.push(node);
    if (!token.endsWith('/>')) stack.push(node);
  }
  const evaluate = (value, scope) => {
    try { return vm.runInNewContext('(' + value.replace(/^{{|}}$/g, '') + ')', scope); }
    catch (_) { return undefined; } // WXML renders absent nested fields as empty.
  };
  const text = (value, scope) => value.replace(/{{([\s\S]*?)}}/g, (_, expression) => evaluate(expression, scope) ?? '');
  function children(nodes, scope) {
    let matched = false, output = '';
    for (const node of nodes) {
      if (typeof node === 'string') { output += text(node, scope); continue; }
      const attrs = node.attrs;
      if ('wx:if' in attrs) { matched = !!evaluate(attrs['wx:if'], scope); if (!matched) continue; }
      else if ('wx:elif' in attrs) { if (matched) continue; matched = !!evaluate(attrs['wx:elif'], scope); if (!matched) continue; }
      else if ('wx:else' in attrs) { if (matched) continue; matched = true; }
      else matched = false;
      const values = 'wx:for' in attrs ? evaluate(attrs['wx:for'], scope) || [] : [null];
      for (let index = 0; index < values.length; index++) {
        const local = 'wx:for' in attrs ? { ...scope, [attrs['wx:for-item'] || 'item']: values[index], [attrs['wx:for-index'] || 'index']: index } : scope;
        output += children(node.children, local) + ' ';
      }
    }
    return output;
  }
  return children(root.children, data).replace(/\s+/g, ' ').trim();
}
module.exports = { renderPage };
