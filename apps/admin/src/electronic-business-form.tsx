import{useState}from'react';import{FormFields}from'./domain-ui';import{readFields,type BusinessField,type BusinessValues}from'./domain-commands';import{ErrorNotice}from'./ui';
export function BusinessForm({fields,submit,disabled,label}:{fields:BusinessField[];submit:(raw:Record<string,unknown>)=>Promise<void>;disabled:boolean;label:string}){
 const [values,setValues]=useState<BusinessValues>({costs:[]}),[error,setError]=useState<unknown>();
 return <form onSubmit={e=>{e.preventDefault();setError(undefined);void Promise.resolve().then(()=>submit(readFields(fields,values))).catch(setError);}}><FormFields fields={fields} values={values} setValues={setValues} disabled={disabled}/>{error?<ErrorNotice error={error}/>:null}<button type="submit" className="button primary" disabled={disabled}>{label}</button></form>;
}
