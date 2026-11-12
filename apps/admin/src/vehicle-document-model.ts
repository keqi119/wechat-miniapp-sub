export const documentCategories={REGISTRATION:'登记证',DRIVING_LICENSE:'行驶证',PURCHASE_CONTRACT:'采购合同',INVOICE:'发票',PURCHASE:'历史购车资料',INSURANCE:'保险资料',BAAS:'电池租赁资料',PAYMENT:'付款凭证',INSPECTION:'年检资料',PHOTO:'历史图片原件',OTHER:'其他资料'} as const;
export type DocumentCategory=keyof typeof documentCategories;
export type VehicleDocumentView='certificates'|'unclassified'|'insurance'|'baas';
export type DocumentItem={id:string;name:string;mimeType:string;size:number;sha256:string;category:DocumentCategory;sourceRelativePath:string;createdAt:string};
export type DocumentList={revision:number;vehicleRevision:number;items:DocumentItem[]};
export type UploadReceipt=DocumentItem&{revision:number;vehicleRevision:number};
export type RemoveReceipt={removed:true;fileId:string;revision:number;vehicleRevision:number};
const certificates:DocumentCategory[]=['REGISTRATION','DRIVING_LICENSE','PURCHASE_CONTRACT','INVOICE'];
export function documentCardCategories(view:VehicleDocumentView):DocumentCategory[]{return view==='certificates'?[...certificates]:view==='insurance'?['INSURANCE']:view==='baas'?['BAAS']:['PURCHASE','PAYMENT','INSPECTION','PHOTO','OTHER'];}
export const documentTypes:Record<string,string>={'application/pdf':'PDF','image/jpeg':'JPEG','image/png':'PNG','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'DOCX','video/mp4':'MP4'};
const extensions:Record<string,string>={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',mp4:'video/mp4'};
export const documentSize=(bytes:number)=>bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MiB`:`${Math.ceil(bytes/1024)} KiB`;
const revision=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
export function validDocumentPath(value:string){return value.length>0&&value.length<=1000&&!/[\\:\x00-\x1f\x7f]/.test(value)&&value.split('/').every(x=>x&&x!=='.'&&x!=='..');}
export function prepareDocumentFile(file:File):File{
 if(!file.name||file.name.includes('/')||!validDocumentPath(file.name))throw new Error('文件名不可包含路径、冒号、控制字符或上级目录。');
 const type=!file.type||file.type==='application/octet-stream'?extensions[file.name.split('.').at(-1)?.toLowerCase()||'']:file.type;
 if(!type||!documentTypes[type]||file.size<1||file.size>32*1024*1024)throw new Error('请选择非空且不超过32MiB的 PDF、JPEG、PNG、DOCX 或 MP4 文件。');
 return type===file.type?file:new File([file],file.name,{type,lastModified:file.lastModified});
}
function item(value:DocumentItem){return value&&typeof value.id==='string'&&/^[A-Za-z0-9_-]+$/.test(value.id)&&typeof value.name==='string'&&!!value.name&&typeof value.mimeType==='string'&&!!documentTypes[value.mimeType]&&Number.isSafeInteger(value.size)&&value.size>0&&value.size<=32*1024*1024&&/^[a-f0-9]{64}$/.test(value.sha256)&&Object.hasOwn(documentCategories,value.category)&&typeof value.sourceRelativePath==='string'&&validDocumentPath(value.sourceRelativePath)&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt));}
export function checkedDocuments(value:DocumentList):DocumentList{if(!value||!revision(value.revision)||!revision(value.vehicleRevision)||!Array.isArray(value.items)||value.items.some(x=>!item(x))||new Set(value.items.map(x=>x.id)).size!==value.items.length)throw new Error('原件列表格式不完整，请重新读取核对。');return value;}
export function checkedUpload(value:UploadReceipt,expected:{sourceRelativePath:string;category:DocumentCategory;sha256:string;size:number;mimeType:string},from:{revision:number;vehicleRevision:number}){if(!item(value)||!revision(value.revision)||!revision(value.vehicleRevision)||value.revision!==from.revision+1||value.vehicleRevision!==from.vehicleRevision||!Object.entries(expected).every(([key,v])=>value[key as keyof UploadReceipt]===v))throw new Error('上传已受理，原件回执尚未核对完整。');return value;}
export function checkedRemoval(value:RemoveReceipt,fileId:string,from:{revision:number;vehicleRevision:number}){if(value?.removed!==true||value.fileId!==fileId||!revision(value.revision)||value.revision!==from.revision+1||value.vehicleRevision!==from.vehicleRevision)throw new Error('删除已受理，回执尚未核对完整。');return value;}
