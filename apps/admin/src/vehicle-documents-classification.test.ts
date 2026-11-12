import test from 'node:test';
import assert from 'node:assert/strict';
import {documentCardCategories,prepareDocumentFile,documentCategories} from './vehicle-document-model.ts';
test('certificate and business files are assigned only to their own material cards',()=>{
 assert.deepEqual(documentCardCategories('certificates'),['REGISTRATION','DRIVING_LICENSE','PURCHASE_CONTRACT','INVOICE']);
 assert.deepEqual(documentCardCategories('insurance'),['INSURANCE']);assert.deepEqual(documentCardCategories('baas'),['BAAS']);
 const waiting=documentCardCategories('unclassified');assert.deepEqual(waiting,['PURCHASE','PAYMENT','INSPECTION','PHOTO','OTHER']);
 const all=['certificates','insurance','baas','unclassified'].flatMap(view=>documentCardCategories(view as Parameters<typeof documentCardCategories>[0]));assert.equal(new Set(all).size,Object.keys(documentCategories).length);
});
test('Windows empty and generic MIME files use only recognized extensions without changing bytes',async()=>{
 for(const[type,name,expected]of [['','document.PDF','application/pdf'],['application/octet-stream','photo.jpeg','image/jpeg'],['','record.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['','video.mp4','video/mp4']]){
  const original=new File(['synthetic bytes'],name,{type,lastModified:123});const prepared=prepareDocumentFile(original);assert.equal(prepared.type,expected);assert.equal(prepared.name,name);assert.equal(prepared.lastModified,123);assert.equal(await prepared.text(),await original.text());
 }
 for(const file of [new File(['x'],'file.svg',{type:''}),new File(['x'],'fake.pdf',{type:'text/html'}),new File([],'empty.pdf',{type:'application/pdf'}),new File(['x'],'../doc.pdf',{type:'application/pdf'}),new File(['x'],'dir:doc.pdf',{type:'application/pdf'}),new File(['x'],'bad\\doc.pdf',{type:'application/pdf'}),new File(['x'],'bad\x7f.pdf',{type:'application/pdf'})])assert.throws(()=>prepareDocumentFile(file));
});
