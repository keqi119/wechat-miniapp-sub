import type { ModuleNavigation, ModuleView } from './modules/navigation';

// The caller has already filtered roles and grants. Preserve independent
// business leaves and select the real route, never another page's representative.
export function presentationFor(navigation: ModuleNavigation[], route: string): { navigation: ModuleNavigation[]; selectedRoute: string; tabs: ModuleView[]; label?: string } {
  const actualRoute = route.replace(/^#/, '').split('?')[0];
  const visible = navigation.filter(module => module.key === 'dashboard' || module.views.length > 0);
  const leaf = visible.flatMap(module => module.views).find(view => view.key === actualRoute);
  const dashboard = actualRoute === 'dashboard' && visible.some(module => module.key === 'dashboard');
  return { navigation: visible, selectedRoute: leaf?.key ?? (dashboard ? 'dashboard' : ''), tabs: [], ...(leaf ? { label: leaf.label } : {}) };
}
