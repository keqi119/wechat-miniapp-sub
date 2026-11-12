import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&url';

// Vite emits the worker and font data as same-origin assets, including small CMaps.
// No contract bytes or document URL are sent to a third-party viewer.
const cmaps=import.meta.glob<string>('../../node_modules/pdfjs-dist/cmaps/*.bcmap',{eager:true,query:'?url&no-inline',import:'default'});
const fonts=import.meta.glob<string>('../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}',{eager:true,query:'?url&no-inline',import:'default'});
GlobalWorkerOptions.workerSrc=workerUrl;
export function loadLegalPdf(data:Uint8Array,signal:AbortSignal){
 class LocalPdfData {
  async fetch({kind,filename}:{kind:string;filename:string}){
   const directory=kind==='cMapUrl'?'cmaps':kind==='standardFontDataUrl'?'standard_fonts':null;
   const url=directory&&(directory==='cmaps'?cmaps:fonts)[`../../node_modules/pdfjs-dist/${directory}/${filename}`];
   if(!url)throw Error('PDF 字体资源不可用');
   const response=await fetch(url,{credentials:'same-origin',signal});
   if(!response.ok)throw Error('PDF 字体资源未能读取');
   return new Uint8Array(await response.arrayBuffer());
  }
 }
 return getDocument({data,BinaryDataFactory:LocalPdfData,useWorkerFetch:false,useWasm:false,disableFontFace:true,useSystemFonts:true,disableWorkerRendering:true,stopAtErrors:true,enableXfa:false});
}
