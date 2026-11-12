import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseResidualCsv,yuanToFen} from '../src/residual-market/csv';
const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;

test('yuan strings convert with decimal half-up rounding without binary floating error, including Int maximum',()=>{
 for(const [input,want] of [['0',0],[' 1.005 ',101],['2.675',268],['0.004999',0],['0.005',1],['0012.999',1300],['1,234.56',123456],['21474836.47',2147483647],['21474836.474',2147483647]] as const)assert.equal(yuanToFen(input),want,input);
 for(const bad of ['',' ','-1','+1','1e2','NaN','Infinity','1.2.3','1,23','1 234.00','21474836.475','9999999999999999999999999999999999999999999',null,1.005])assert.throws(()=>yuanToFen(bad as any));
});

test('CSV supports BOM, escaped double quotes, commas, CRLF and embedded newlines with physical row numbers',()=>{
 const text='\uFEFFmodelDefinitionId,priceAmount,sourceNote\r\nm1,"1,234.56","他说""已核对"",价格"\r\nm2,0.01,"第一行\n第二行"\r\n\r\nm3,2,末行';const parsed=parseResidualCsv(text);
 assert.deepEqual(parsed.headers,['modelDefinitionId','priceAmount','sourceNote']);assert.deepEqual(parsed.records,[{rowNumber:2,values:{modelDefinitionId:'m1',priceAmount:'1,234.56',sourceNote:'他说"已核对",价格'}},{rowNumber:3,values:{modelDefinitionId:'m2',priceAmount:'0.01',sourceNote:'第一行\n第二行'}},{rowNumber:6,values:{modelDefinitionId:'m3',priceAmount:'2',sourceNote:'末行'}}]);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.rowCount,3);assert.equal(parsed.csvHash,createHash('sha256').update(text,'utf8').digest('hex'));
});

test('malformed rows are reported without silently dropping extra cells or consuming valid following records',()=>{
 const parsed=parseResidualCsv('a,b\n1,2,3\nshort\nwrong"quote,4\n"closed"x,5\nok,6\n"unterminated,7');assert.equal(parsed.rowCount,6);assert.deepEqual(parsed.records,[{rowNumber:6,values:{a:'ok',b:'6'}}]);assert.deepEqual(parsed.errors.map(e=>[e.rowNumber,e.code]),[[2,'CSV_ROW_COLUMNS'],[3,'CSV_ROW_COLUMNS'],[4,'CSV_SYNTAX'],[5,'CSV_SYNTAX'],[7,'CSV_SYNTAX']]);
 for(const header of ['a,a\nx,y',',b\nx,y','"bad\nheader'])assert.throws(()=>parseResidualCsv(header),error('CSV_HEADER'));
 assert.deepEqual(parseResidualCsv('').records,[]);assert.deepEqual(parseResidualCsv('a,b\n , \n').records,[]);
});

test('CSV limits count logical data records including bad rows, not quoted physical newlines',()=>{
 const atLimit='a,b\n'+Array.from({length:1000},(_,i)=>`${i},"one\ntwo"`).join('\n');assert.equal(parseResidualCsv(atLimit).rowCount,1000);assert.throws(()=>parseResidualCsv(atLimit+'\nlast,record'),error('CSV_ROW_LIMIT'));
 const badAtLimit='a,b\n'+Array(1000).fill('three,wrong,cells').join('\n');assert.equal(parseResidualCsv(badAtLimit).errors.length,1000);assert.throws(()=>parseResidualCsv(badAtLimit+'\nanother,bad,row'),error('CSV_ROW_LIMIT'));
});

test('an explicitly empty header cannot silently promote the first data record to a header',()=>{
 for(const text of [',\nvalue,price','""\nvalue',' , \nvalue,price'])assert.throws(()=>parseResidualCsv(text),error('CSV_HEADER'));
});

test('CSV size limit is exactly 2 MiB in UTF-8 bytes including BOM and multibyte characters',()=>{
 const prefix='a\n',text=prefix+'x'.repeat(2*1024*1024-Buffer.byteLength(prefix));assert.equal(parseResidualCsv(text).records[0].values.a.length,2*1024*1024-2);assert.throws(()=>parseResidualCsv(text+'x'),error('CSV_SIZE_LIMIT'));
 const chinese='a\n'+'中'.repeat(699050);assert.equal(Buffer.byteLength(chinese),2097152);assert.equal(parseResidualCsv(chinese).rowCount,1);assert.throws(()=>parseResidualCsv('\uFEFF'+chinese),error('CSV_SIZE_LIMIT'));
});
