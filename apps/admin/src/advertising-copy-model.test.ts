import test from 'node:test';
import assert from 'node:assert/strict';
import {advertisingCopyIds,normalizeItems,canPublish,type CopyItem} from './advertising-copy-model.ts';
export const items=():CopyItem[]=>advertisingCopyIds.map(id=>({id,title:'新旅程',lines:['首页第一行','首页第二行'],catalogDescription:'选车说明'}));
test('strict fixed slots and unicode codepoint lengths match API',()=>{
 const value=items();value[0].title=' 😀😀😀😀😀😀😀😀😀 ';assert.equal(normalizeItems(value)[0].title,'😀'.repeat(9));
 for(const bad of ['😀'.repeat(10),'','a\nb','a\tb','a\u0085b','a\u2028b','<b>']){const input=items();input[0].title=bad;assert.throws(()=>normalizeItems(input));}
 const input=items();input.reverse();assert.throws(()=>normalizeItems(input));
 const line=items();line[0].lines[0]='字'.repeat(33);assert.throws(()=>normalizeItems(line));line[0].lines[0]='字';line[0].catalogDescription='字'.repeat(41);assert.throws(()=>normalizeItems(line));
});
test('publish requires saved unchanged input and different published hash',()=>{assert.equal(canPublish(items(),items(),'a','b'),true);const edited=items();edited[0].title='未保存';assert.equal(canPublish(edited,items(),'a','b'),false);assert.equal(canPublish(items(),items(),'a','a'),false);});
