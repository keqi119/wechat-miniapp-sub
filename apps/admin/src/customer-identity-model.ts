export function customerIdentityColumnVisible(key:string,role?:string){return !key.startsWith('identity.')||['ADMIN','OPERATIONS'].includes(role||'');}
export function customerIdentityDisplay(identity:unknown){
 const value=identity&&typeof identity==='object'&&!Array.isArray(identity)?identity as Record<string,unknown>:{};
 const verified=value.status==='VERIFIED'&&value.verified===true;
 const status=verified?'已实名':value.verified===true?'待核实':({NOT_STARTED:'未实名',PENDING:'认证中',FAILED:'认证未通过'} as Record<string,string>)[String(value.status)]||'待核实';
 const name=verified&&typeof value.name==='string'&&value.name.trim().length<=40?value.name.trim():'';
 const maskedIdCardNo=verified&&typeof value.maskedIdCardNo==='string'&&/^[0-9Xx]{3,6}\*{4,14}[0-9Xx]{2,4}$/.test(value.maskedIdCardNo)?value.maskedIdCardNo:'';
 const verifiedAt=verified&&typeof value.verifiedAt==='string'&&Number.isFinite(Date.parse(value.verifiedAt))?value.verifiedAt:null;
 return{verified,status,name,maskedIdCardNo,verifiedAt};
}
