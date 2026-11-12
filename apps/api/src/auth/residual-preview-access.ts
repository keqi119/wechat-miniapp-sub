import {allowed} from './role-policy';

const previews=new Map([
 ['/admin/residual-imports/preview','residual-imports'],
 ['/admin/residual-curves/preview','residual-curves'],
 ['/admin/residual-forecasts/preview','residual-forecasts'],
]);

/** These POST bodies perform read-only calculation. They still require the
 * normal authenticated session, Origin and CSRF checks in Access. */
export function residualPreviewAllowed(role:string,path:string,method:string):boolean|null{
 const resource=method==='POST'?previews.get(path):undefined;
 return resource?allowed(role,resource,false):null;
}
