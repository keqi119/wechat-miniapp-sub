import {createHash} from 'node:crypto';
import {ensure} from '../common/errors';

export const RESIDUAL_CSV_MAX_BYTES=2*1024*1024;
export const RESIDUAL_CSV_MAX_ROWS=1000;
export type ResidualCsvRecord={rowNumber:number;values:Record<string,string>};
export type ResidualCsvError={rowNumber:number;code:'CSV_ROW_COLUMNS'|'CSV_SYNTAX';message:string};
export type ResidualCsvResult={headers:string[];records:ResidualCsvRecord[];errors:ResidualCsvError[];rowCount:number;csvHash:string};

/** Positive or zero decimal yuan -> integer fen; callers enforce required >0.
 * Proper thousands grouping is accepted, exponents and signs are not. */
export function yuanToFen(value:string):number{
 ensure(typeof value==='string',400,'RESIDUAL_AMOUNT','元金额须为十进制字符串');const text=value.trim();
 ensure(text.length<=100&&/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text),400,'RESIDUAL_AMOUNT','元金额格式无效');
 const [whole,fraction='']=text.replaceAll(',','').split('.'),digits=(fraction+'00').slice(0,2),roundUp=fraction.length>2&&fraction[2]>='5';
 const amount=BigInt(whole)*100n+BigInt(digits)+(roundUp?1n:0n);ensure(amount<=2147483647n,400,'AMOUNT_OVERFLOW','金额超出整数分上限');return Number(amount);
}

/** Pure CSV structure parsing. Semantic fields, dedupe and DB writes belong to
 * the importer. Recoverable bad records are explicit; no cells are truncated. */
export function parseResidualCsv(text:string):ResidualCsvResult{
 ensure(typeof text==='string',400,'CSV_INPUT','CSV 须为文本');ensure(Buffer.byteLength(text,'utf8')<=RESIDUAL_CSV_MAX_BYTES,400,'CSV_SIZE_LIMIT','CSV 最多 2 MiB');
 const result:ResidualCsvResult={headers:[],records:[],errors:[],rowCount:0,csvHash:createHash('sha256').update(text,'utf8').digest('hex')};
 const input=text.startsWith('\uFEFF')?text.slice(1):text;let headerRead=false,cells:string[]=[],cell='',quoted=false,closed=false,syntaxError=false,punctuated=false,line=1,rowStart=1;
 const finish=()=>{
  cells.push(cell);const values=cells.map(value=>value.trim());
  if(values.some(Boolean)||syntaxError||!headerRead&&punctuated){
   if(!headerRead){
    ensure(!syntaxError&&values.every(Boolean)&&new Set(values).size===values.length,400,'CSV_HEADER','CSV 表头须非空、唯一且语法完整');result.headers=values;headerRead=true;
   }else{
    result.rowCount++;ensure(result.rowCount<=RESIDUAL_CSV_MAX_ROWS,400,'CSV_ROW_LIMIT','CSV 最多 1000 条数据记录');
    if(syntaxError)result.errors.push({rowNumber:rowStart,code:'CSV_SYNTAX',message:'引号语法不完整或引号位置无效'});
    else if(values.length!==result.headers.length)result.errors.push({rowNumber:rowStart,code:'CSV_ROW_COLUMNS',message:'本行字段数量与表头不一致'});
    else result.records.push({rowNumber:rowStart,values:Object.fromEntries(result.headers.map((header,index)=>[header,values[index]]))});
   }
  }
  cells=[];cell='';quoted=false;closed=false;syntaxError=false;punctuated=false;
 };
 for(let index=0;index<input.length;index++){
  const char=input[index];
  if(quoted){
   if(char==='"'){if(input[index+1]==='"'){cell+='"';index++;}else{quoted=false;closed=true;}}
   else{cell+=char;if(char==='\n'||char==='\r'&&input[index+1]!=='\n')line++;}
   continue;
  }
  if(char==='\r'||char==='\n'){
   finish();if(char==='\r'&&input[index+1]==='\n')index++;line++;rowStart=line;continue;
  }
  if(char===','){punctuated=true;cells.push(cell);cell='';closed=false;continue;}
  if(char==='"'){
   punctuated=true;if(cell===''&&!closed)quoted=true;else{syntaxError=true;cell+=char;}
   continue;
  }
  if(closed&&char!==' '&&char!=='\t')syntaxError=true;
  cell+=char;
 }
 if(quoted)syntaxError=true;if(cells.length||cell||syntaxError||punctuated)finish();return result;
}
