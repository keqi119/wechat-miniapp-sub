import './process-navigation.css';
import {useEffect,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {processReturnTarget,returnToProcess} from './process-navigation';
export function ProcessReturn({userId}:{userId:string}){
 const[hash,setHash]=useState(()=>window.location.hash);
 useEffect(()=>{const update=()=>setHash(window.location.hash);window.addEventListener('hashchange',update);window.addEventListener('process-location',update);return()=>{window.removeEventListener('hashchange',update);window.removeEventListener('process-location',update);};},[]);
 const target=processReturnTarget(hash);if(!target)return null;
 return <div className="process-return"><button type="button" className="text-button" onClick={()=>returnToProcess(userId)}><ArrowLeft size={15}/>{target.startsWith('#orders?')?'返回本单办理':'返回上一步办理'}</button><span className="muted">保留原记录与办理分区</span></div>;
}
