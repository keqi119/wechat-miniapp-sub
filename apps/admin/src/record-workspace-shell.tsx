import {createContext,useContext,useId,type ReactNode} from 'react';
import {ArrowLeft} from 'lucide-react';
import './workspace-layout.css';

const WorkspacePageContext=createContext(false);
export const useRecordWorkspace=()=>useContext(WorkspacePageContext);
/** A page host, deliberately without dialog role, focus trap or body scroll lock. */
export function RecordWorkspaceShell({title,subtitle,status,onBack,backLabel='返回列表',actions,children,className=''}:{title:string;subtitle?:string;status?:ReactNode;onBack:()=>void;backLabel?:string;actions?:ReactNode;children:ReactNode;className?:string}){
 const id=useId();
 return <WorkspacePageContext.Provider value={true}><section className={`record-workspace-shell ${className}`} aria-labelledby={id}>
  <header className="record-workspace-header"><button className="button workspace-back" aria-label={backLabel} onClick={onBack}><ArrowLeft size={16}/><span>{backLabel}</span></button><div className="record-workspace-identity"><h1 id={id}>{title}</h1>{subtitle?<p title={subtitle}>{subtitle}</p>:null}</div>{status?<div className="record-workspace-status">{status}</div>:null}<div className="record-workspace-actions">{actions}</div></header>
  <div className="record-workspace-body">{children}</div>
 </section></WorkspacePageContext.Provider>;
}
