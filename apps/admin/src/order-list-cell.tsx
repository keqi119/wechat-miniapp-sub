import './order-list.css';
import {orderListCell,orderVehicleContext} from './order-list-model';
export function OrderListCell({row,column}:{row:Record<string,unknown>;column:string}){
 const lines=orderListCell(row,column);
 return <div className={'order-list-cell order-list-'+column}>{column==='vehicle'&&typeof row.vehicleContext==='string'?<small className="muted">{orderVehicleContext(row.vehicleContext)}</small>:null}{lines.map((line,index)=><span key={index} className={line.includes('待核')?'muted':undefined}>{line}</span>)}</div>;
}
