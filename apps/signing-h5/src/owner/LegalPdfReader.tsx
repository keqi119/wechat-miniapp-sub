import {useEffect,useRef,useState} from 'react';
import type {PDFDocumentLoadingTask,PDFDocumentProxy,RenderTask} from 'pdfjs-dist/types/src/display/api';
import type {LegalClient} from './legal-client';
import type {LegalFileVariant} from './legal-documents';

export function LegalPdfReader({api,path,title,variant,onReady,onExpired,onClose}:{api:LegalClient;path:string;title:string;variant:LegalFileVariant;onReady:(ready:boolean)=>void;onExpired:()=>void;onClose:()=>void}){
 const [document,setDocument]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[zoom,setZoom]=useState(1),[width,setWidth]=useState(0),[loading,setLoading]=useState(true),[rendering,setRendering]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const container=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),callbacks=useRef({onReady,onExpired});
 callbacks.current={onReady,onExpired};
 const variantLabel=variant==='source'?'文件原件':'签后文件';
 useEffect(()=>{
  const element=container.current;if(!element)return;
  const measure=()=>{const next=Math.floor(element.clientWidth);if(next>0)setWidth(next);};
  measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  let active=true,task:PDFDocumentLoadingTask|undefined;
  const controller=new AbortController();
  setDocument(null);setPage(1);setZoom(1);setLoading(true);setError('');callbacks.current.onReady(false);
  void (async()=>{
   const [engine,blob]=await Promise.all([import('./legal-pdf-engine'),api.request<Blob>(path,undefined,{signal:controller.signal})]);
   if(!active)return;
   const data=new Uint8Array(await blob.arrayBuffer());if(!active)return;
   task=engine.loadLegalPdf(data,controller.signal);
   const pdf=await task.promise;if(!active)return;
   if(pdf.numPages<1)throw Error('PDF 没有可读取的页面');
   setDocument(pdf);setLoading(false);
  })().catch(e=>{
   if(!active)return;
   callbacks.current.onReady(false);setLoading(false);
   if(e?.name==='LEGAL_SESSION_EXPIRED'){callbacks.current.onExpired();return;}
   setError(e instanceof Error&&/[\u4e00-\u9fff]/.test(e.message)?e.message:'PDF 未能显示，请重新读取；也可下载文件后阅读。');
  });
  return()=>{active=false;controller.abort();void task?.destroy().catch(()=>{});};
 },[api,path,retry]);
 useEffect(()=>{
  if(!document||!width||!canvas.current)return;
  let active=true,render:RenderTask|undefined;
  const target=canvas.current;
  setRendering(true);setError('');callbacks.current.onReady(false);target.width=1;target.height=1;
  void (async()=>{
   const current=await document.getPage(page);if(!active)return;
   const natural=current.getViewport({scale:1}),viewport=current.getViewport({scale:width/natural.width*zoom});
   // Bound canvas memory for high-DPI phones while keeping zoomed text legible.
   const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(8_000_000/(viewport.width*viewport.height)));
   target.width=Math.max(1,Math.floor(viewport.width*ratio));target.height=Math.max(1,Math.floor(viewport.height*ratio));
   target.style.width=`${Math.floor(viewport.width)}px`;target.style.height=`${Math.floor(viewport.height)}px`;
   render=current.render({canvas:target,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});
   await render.promise;if(!active)return;
   setRendering(false);callbacks.current.onReady(true);
  })().catch(e=>{
   if(!active)return;
   setRendering(false);callbacks.current.onReady(false);
   setError(e instanceof Error&&/[\u4e00-\u9fff]/.test(e.message)?e.message:'本页未能显示，请重新读取 PDF。');
  });
  return()=>{active=false;render?.cancel();};
 },[document,page,zoom,width]);
 return <section className="legal-pdf-reader" aria-label={`${title} · ${variantLabel}`}>
  <div className="legal-pdf-heading"><h3>{variantLabel}</h3><button type="button" className="text-button" onClick={onClose}>关闭阅读</button></div>
  {document&&<div className="legal-pdf-tools">
   <div className="legal-pdf-pages"><button type="button" className="secondary" disabled={page===1||rendering} onClick={()=>setPage(v=>v-1)}>上一页</button><span aria-live="polite">第 {page} / {document.numPages} 页</span><button type="button" className="secondary" disabled={page===document.numPages||rendering} onClick={()=>setPage(v=>v+1)}>下一页</button></div>
   <div className="legal-pdf-zoom"><button type="button" className="secondary" disabled={zoom<=.75||rendering} onClick={()=>setZoom(v=>Math.max(.75,v-.25))} aria-label="缩小 PDF">−</button><span>{Math.round(zoom*100)}%</span><button type="button" className="secondary" disabled={zoom>=2.5||rendering} onClick={()=>setZoom(v=>Math.min(2.5,v+.25))} aria-label="放大 PDF">＋</button><button type="button" className="text-button" disabled={zoom===1||rendering} onClick={()=>setZoom(1)}>适合宽度</button></div>
  </div>}
  {(loading||rendering)&&<p role="status" className="legal-pdf-message">{loading?'正在读取 PDF…':'正在显示页面…'}</p>}
  {error&&<div role="alert" className="legal-pdf-message"><p>{error}</p><button type="button" className="secondary" onClick={()=>setRetry(v=>v+1)}>重新读取 PDF</button></div>}
  <div className="legal-pdf-viewport" ref={container} aria-busy={loading||rendering}>
   <canvas ref={canvas} className="legal-pdf-canvas" hidden={loading||rendering||!!error} role="img" aria-label={`${title} ${variantLabel} 第 ${page} 页`}/>
  </div>
  <div className="legal-pdf-download"><a className="secondary" href={`/owner/api${path}`} download={`${title}-${variantLabel}.pdf`}>下载{variant==='source'?'原件':'签后'} PDF</a><p>可翻页阅读全部内容。放大后可左右移动；若微信未显示下载，请在浏览器中打开本页后保存。</p></div>
 </section>;
}
