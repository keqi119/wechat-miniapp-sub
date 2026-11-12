export const baasListFilterKeys=['provider','providerExact','brand','brandExact','model','modelExact','lesseeName','lesseeNameExact'] as const;
export type BaasFilters=Partial<Record<typeof baasListFilterKeys[number],string>>;
export type BaasFilterDraft=Partial<Record<'provider'|'brand'|'model'|'lesseeName',string>>;
export type BaasFilterOptions={providers:string[];brands:string[];models:{brand:string;model:string}[];lessees:string[]};
export function baasFiltersFromDraft(draft:BaasFilterDraft,options:BaasFilterOptions):BaasFilters{
 const result:BaasFilters={};for(const key of ['provider','brand','model','lesseeName'] as const){const value=String(draft[key]||'').trim();if(!value)continue;const choices=key==='provider'?options.providers:key==='brand'?options.brands:key==='model'?options.models.filter(row=>!draft.brand||row.brand.toLocaleLowerCase().includes(draft.brand.trim().toLocaleLowerCase())).map(row=>row.model):options.lessees;const field=(choices.includes(value)?`${key}Exact`:key) as keyof BaasFilters;result[field]=value;}baasFilterQuery(result);return result;
}
export function baasFilterQuery(filters:BaasFilters,vehicleId?:string):URLSearchParams{
 const query=new URLSearchParams();if(vehicleId){if(!/^[A-Za-z0-9_-]{1,128}$/.test(vehicleId))throw Error('车辆范围无效，请重新进入');query.set('vehicleId',vehicleId);}
 for(const key of ['provider','brand','model','lesseeName'] as const){if(filters[key]&&filters[`${key}Exact`])throw Error('同一项不能同时提交精确与包含筛选');for(const field of [key,`${key}Exact`] as const){const value=String(filters[field]||'').trim();if(value.length>(key==='lesseeName'?200:500)||value.includes('\0'))throw Error(key==='lesseeName'?'承租人筛选最多200字':'筛选文字最多500字');if(value)query.set(field,value);}}
 return query;
}
