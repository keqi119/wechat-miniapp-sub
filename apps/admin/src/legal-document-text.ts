export function legalBody(content:string):string{
 try{const parsed:unknown=JSON.parse(content);if(typeof parsed==='string')return parsed;if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&typeof (parsed as {body?:unknown}).body==='string')return (parsed as {body:string}).body;}catch{/* Plain text templates are supported as stored. */}
 return content;
}
type LegalBlock={kind:'heading'|'clause'|'paragraph';text:string}|{kind:'table';text:string;headers:string[];rows:string[][]};
const cells=(line:string)=>line.replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(cell=>cell.trim().replace(/\\\|/g,'|'));
export function legalBlocks(body:string):LegalBlock[]{
 const lines=body.replace(/\r\n?/g,'\n').split('\n').map(line=>line.trim()),blocks:LegalBlock[]=[];
 for(let index=0;index<lines.length;index++){
  const line=lines[index];if(!line)continue;
  if(line.startsWith('|')&&lines[index+1]?.startsWith('|')&&cells(lines[index+1]).every(cell=>/^:?-{3,}:?$/.test(cell))){
   const headers=cells(line),rows:string[][]=[];
   if(headers.length===cells(lines[index+1]).length){index++;while(lines[index+1]?.startsWith('|')&&cells(lines[index+1]).length===headers.length)rows.push(cells(lines[++index]));blocks.push({kind:'table',text:line,headers,rows});continue;}
  }
  const heading=/^#{1,6}\s+/.test(line)||/^第[一二三四五六七八九十百零〇\d]+[条章节]\s*\S/.test(line)||/^[一二三四五六七八九十百]+[、\s]\s*[^。；]{1,45}$/.test(line);
  blocks.push({kind:heading?'heading':/^\d+(?:\.\d+)+(?:[、.\s]|$)|^[（(][一二三四五六七八九十\d]+[）)]/.test(line)?'clause':'paragraph',text:line.replace(/^#{1,6}\s+/,'').replace(/^[-*] /,'• ')});
 }return blocks;
}
