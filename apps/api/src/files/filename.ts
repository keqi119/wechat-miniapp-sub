import {TextDecoder} from 'node:util';

const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});

/** Recover UTF-8 multipart filename bytes decoded as Latin-1. Never lossy-decode real Unicode or legacy Latin-1. */
export function readableFileName(name:string):string{
 if(!/[\u0080-\u00ff]/.test(name)||Array.from(name).some(character=>character.codePointAt(0)!>0xff))return name;
 const bytes=Buffer.from(name,'latin1');
 try{const decoded=utf8.decode(bytes);return Buffer.from(decoded,'utf8').equals(bytes)?decoded:name;}catch{return name;}
}

export function uploadedFileName(name:string):string{return readableFileName(name).replace(/[\r\n\\/]/g,'_').slice(0,200).replace(/[\uD800-\uDBFF]$/,'');}
