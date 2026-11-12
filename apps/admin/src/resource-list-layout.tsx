import {createContext,useContext,useId,type ReactNode} from 'react';
import {Info} from 'lucide-react';
import './workspace-layout.css';
import './compact-filters.css';

const ListNavigationContext=createContext<ReactNode>(null);
export const useResourceListNavigation=()=>useContext(ListNavigationContext);
export function ResourceListNavigationProvider({navigation,children}:{navigation?:ReactNode;children:ReactNode}){return <ListNavigationContext.Provider value={navigation}>{children}</ListNavigationContext.Provider>;}
/** One title/navigation row and one filter row; the data area owns scrolling. */
export function ResourceListLayout({title,description,count,actions,toolbar,pagination,children,className=''}:{title:string;description?:string;count?:number;actions?:ReactNode;toolbar?:ReactNode;pagination?:ReactNode;children:ReactNode;className?:string}){
 const navigation=useContext(ListNavigationContext),id=useId();
 return <section className={`resource-list-layout ${className}`} aria-labelledby={id}>
  <header className="resource-list-heading"><div className="resource-list-title"><h1 id={id}>{title}</h1>{count!==undefined?<span className="resource-list-count">{count} 条</span>:null}{description?<details className="resource-list-help"><summary aria-label={`${title}办理说明`}><Info size={17}/></summary><div role="note">{description}</div></details>:null}</div><div className="resource-list-navigation">{navigation}</div><div className="resource-list-actions">{actions}</div></header>
  {toolbar?<div className="resource-list-toolbar">{toolbar}</div>:null}
  <div className="resource-list-content">{children}</div>
  {pagination?<footer className="resource-list-pagination">{pagination}</footer>:null}
 </section>;
}
