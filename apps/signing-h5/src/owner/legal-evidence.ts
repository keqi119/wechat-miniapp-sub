export interface EvidenceContext {
 ownerId:string;sessionBinding:string;taskId:string;taskRevision:number;sourceHash:string;
 grantId:string;grantRevision:number;grantSourceHash:string;fileId:string;
}
export function evidenceSelection(context:EvidenceContext){return JSON.stringify(context);}
export interface EvidencePreview {selection:string;blob:Blob;sha256:string;ticket:number}
/** A request ticket also invalidates A→B→A and concurrent requests for the same file. */
export class BoundEvidenceReader {
 private selection='';
 private ticket=0;
 select(selection:string){
  if(selection!==this.selection){this.selection=selection;this.invalidate();}
 }
 invalidate(){this.ticket++;}
 matches(preview:Pick<EvidencePreview,'selection'|'sha256'|'ticket'>|null,key:string,hash:string){
  return !!preview&&preview.ticket===this.ticket&&key===this.selection&&evidencePreviewMatches(preview,key,hash);
 }
 async read(selection:string,download:()=>Promise<Blob>):Promise<EvidencePreview|null>{
  if(selection!==this.selection)return null;
  const ticket=++this.ticket;
  const current=()=>ticket===this.ticket&&selection===this.selection;
  try{
   const blob=await download();
   if(!current())return null;
   const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
   if(!current())return null;
   return {selection,blob,ticket,sha256:Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')};
  }catch(error){if(current())throw error;return null;}
 }
}
export function evidencePreviewMatches(preview:Pick<EvidencePreview,'selection'|'sha256'>|null,key:string,hash:string){
 return !!preview&&preview.selection===key&&preview.sha256===hash;
}
