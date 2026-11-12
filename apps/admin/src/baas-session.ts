import {useCallback,useEffect,useRef,useState} from 'react';
import {assetSessionLease} from './asset-shared';

/** A command belongs to the exact session that rendered its record. */
export function useBaasLease(){
 const lease=useRef(assetSessionLease()),[valid,setValid]=useState(()=>lease.current());
 useEffect(()=>{const check=()=>{if(!lease.current())setValid(false);};window.addEventListener('admin-session-change',check);return()=>window.removeEventListener('admin-session-change',check);},[]);
 const revoke=useCallback(()=>setValid(false),[]);
 return {valid:valid&&lease.current(),current:lease.current,revoke};
}
