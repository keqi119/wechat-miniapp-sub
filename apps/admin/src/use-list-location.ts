import {useEffect,useRef,useState} from 'react';
import {listLocationState,syncListLocation,type ListLocationState} from './process-navigation';

/** Shared URL state for lists; draft business forms never enter browser storage. */
export function useListLocation(){
 const[state,setState]=useState(()=>listLocationState(window.location.hash)),current=useRef(state);
 const write=(patch:Partial<ListLocationState>)=>{const next={...current.current,...patch};current.current=next;setState(next);syncListLocation(next);};
 useEffect(()=>{const read=()=>{const next=listLocationState(window.location.hash);current.current=next;setState(previous=>previous.keyword===next.keyword&&previous.status===next.status&&previous.page===next.page?previous:next);};window.addEventListener('hashchange',read);window.addEventListener('process-location',read);return()=>{window.removeEventListener('hashchange',read);window.removeEventListener('process-location',read);};},[]);
 return {...state,setKeyword:(keyword:string)=>write({keyword}),setStatus:(status:string)=>write({status}),setPage:(page:number|((value:number)=>number))=>write({page:typeof page==='function'?page(current.current.page):page})};
}
