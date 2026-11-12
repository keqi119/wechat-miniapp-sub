import {openSync,readSync,closeSync} from 'node:fs';

// The deployment image ships Noto's TTC collection; PDFKit requires a concrete face.
// A standalone TTF/OTF keeps its existing face selection.
export function useCjkFont(doc:PDFKit.PDFDocument,path:string,face=process.env.CONTRACT_CJK_FONT_FACE||'NotoSansCJKsc-Regular'){
 const fd=openSync(path,'r');const header=Buffer.alloc(4);
 try{readSync(fd,header,0,4,0);}finally{closeSync(fd);}
 return header.toString('ascii')==='ttcf'?doc.font(path,face):doc.font(path);
}
