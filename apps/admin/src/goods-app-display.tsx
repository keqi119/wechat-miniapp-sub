import {goodsAppDisplayView} from './goods-app-display-model';
export function GoodsAppDisplayStatus({value}:{value?:unknown}){
 const view=goodsAppDisplayView(value);
 return <div aria-label="App 展示状态"><span className={`status ${view.tone}`} title={view.checkedAt?`核对时间：${view.checkedAt}`:undefined}>{view.label}</span>{view.reasons.map((reason,index)=><small className="goods-secondary" key={index}>{reason}</small>)}</div>;
}
