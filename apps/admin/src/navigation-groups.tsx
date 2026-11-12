import { useLayoutEffect, useRef } from 'react';
import type { ModuleView } from './modules/navigation';
import './navigation-groups.css';

export function PageFunctionTabs({ tabs, route, label }: { tabs: ModuleView[]; route: string; label?: string }) {
  const scroller = useRef<HTMLElement>(null);
  const actualRoute = route.replace(/^#/, '').split('?')[0];
  useLayoutEffect(() => {
    const container = scroller.current;
    const active = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !active) return;
    const outer = container.getBoundingClientRect(), inner = active.getBoundingClientRect();
    if (inner.left < outer.left) container.scrollLeft -= outer.left - inner.left;
    else if (inner.right > outer.right) container.scrollLeft += inner.right - outer.right;
  }, [actualRoute, tabs]);
  if (tabs.length <= 1) return null;
  return <nav ref={scroller} className="page-function-tabs" aria-label={`${label ?? '页面'}功能导航`}>
    {tabs.map(tab => <a key={tab.key} href={`#${tab.key}`} aria-current={actualRoute === tab.key ? 'page' : undefined}>{tab.label}</a>)}
  </nav>;
}
