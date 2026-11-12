import {
  AppstoreOutlined, CarOutlined, DashboardOutlined, DollarOutlined,
  FileTextOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  SettingOutlined, ShopOutlined, ShoppingCartOutlined, TeamOutlined,
} from '@ant-design/icons';
import { App as AntApp, Button, ConfigProvider, Layout, Menu, Space, Tag, Typography, type MenuProps } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { ModuleNavigation } from './modules/navigation';
import './inherited-admin-shell.css';

// Presentation inherited from subscription-Saas db4b48c5, providers/AdminShellFrame.
// This shell deliberately receives navigation and identity; it never loads auth data.
export function AdminTheme({ children }: { children: ReactNode }) {
  return <ConfigProvider locale={zhCN} theme={{
    token: { borderRadius: 6, colorPrimary: '#1677ff', fontFamily: 'Arial, Microsoft YaHei, PingFang SC, sans-serif' },
    components: { Layout: { bodyBg: '#f5f7fb', headerBg: '#ffffff', siderBg: '#111827' } },
  }}><AntApp className="inherited-admin-theme">{children}</AntApp></ConfigProvider>;
}

export interface InheritedAdminShellProps {
  navigation: ModuleNavigation[];
  route: string;
  userId: string;
  userName: string;
  roleLabel: string;
  onNavigate: (key: string) => void;
  onLogout: () => void;
  children: ReactNode;
  onContentClick?: (event: MouseEvent<HTMLElement>) => void;
}

type MenuState = { openKeys: string[]; scrollTop: number };
const groupKey = (key: string) => `module:${key}`;
const isNarrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 991.98px)').matches;

function readMenuState(key: string, allowed: Set<string>): MenuState {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (raw && typeof raw === 'object') {
      const value = raw as Partial<MenuState>;
      return {
        openKeys: Array.isArray(value.openKeys) ? [...new Set(value.openKeys.filter(item => typeof item === 'string' && allowed.has(item)))] : [],
        scrollTop: typeof value.scrollTop === 'number' && Number.isFinite(value.scrollTop) && value.scrollTop >= 0 ? value.scrollTop : 0,
      };
    }
  } catch { /* Storage may be unavailable; navigation still works in memory. */ }
  return { openKeys: [], scrollTop: 0 };
}

function navigationIcon(key: string): ReactNode {
  switch (key) {
    case 'dashboard': return <DashboardOutlined />;
    case 'customers': return <TeamOutlined />;
    case 'vehicles': return <CarOutlined />;
    case 'products': return <AppstoreOutlined />;
    case 'goods': return <ShopOutlined />;
    case 'orders': return <ShoppingCartOutlined />;
    case 'finance': return <DollarOutlined />;
    case 'settings': return <SettingOutlined />;
    default: return <FileTextOutlined />;
  }
}

export function InheritedAdminShell(props: InheritedAdminShellProps) {
  // Identity changes immediately discard previous menu state and mounted page content.
  return <ShellState key={JSON.stringify([props.userId, props.roleLabel])} {...props} />;
}

function ShellState({ navigation, route, userId, userName, roleLabel, onNavigate, onLogout, children, onContentClick }: InheritedAdminShellProps) {
  const routeKey = route.replace(/^#/, '').split('?')[0];
  const groupKeys = useMemo(() => navigation.filter(item => item.views.length > 0).map(item => groupKey(item.key)), [navigation]);
  const allowedGroups = useMemo(() => new Set(groupKeys), [groupKeys]);
  const leafKeys = useMemo(() => new Set(navigation.flatMap(item => item.views.length ? item.views.map(view => view.key) : [item.key])), [navigation]);
  const activeGroup = navigation.find(item => item.views.some(view => view.key === routeKey));
  const activeGroupKey = activeGroup ? groupKey(activeGroup.key) : undefined;
  const storageKey = `ninda:inherited-admin-menu:v1:${encodeURIComponent(userId)}:${encodeURIComponent(roleLabel)}`;
  const [initial] = useState(() => readMenuState(storageKey, allowedGroups));
  const [openKeys, setOpenKeys] = useState(() => [...new Set([...initial.openKeys, ...(activeGroupKey ? [activeGroupKey] : [])])]);
  const [narrow, setNarrow] = useState(isNarrow);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuScroll = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const scrollTop = useRef(initial.scrollTop);
  const validOpenKeys = openKeys.filter(key => allowedGroups.has(key));
  const groupSignature = JSON.stringify(groupKeys);
  const openSignature = JSON.stringify(validOpenKeys);
  const hidden = narrow && !mobileOpen;

  useEffect(() => {
    const allowed = new Set<string>(JSON.parse(groupSignature));
    setOpenKeys(current => {
      const next = current.filter(key => allowed.has(key));
      if (activeGroupKey && allowed.has(activeGroupKey) && !next.includes(activeGroupKey)) next.push(activeGroupKey);
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });
  }, [activeGroupKey, groupSignature]);

  useLayoutEffect(() => {
    const restore = () => { if (menuScroll.current) menuScroll.current.scrollTop = scrollTop.current; };
    restore();
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [openSignature]);

  function remember(keys = validOpenKeys) {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ openKeys: keys, scrollTop: scrollTop.current })); }
    catch { /* A blocked storage policy must not block navigation. */ }
  }

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ openKeys: JSON.parse(openSignature), scrollTop: scrollTop.current })); }
    catch { /* See remember. */ }
  }, [openSignature, storageKey]);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); toggle.current?.focus(); }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);

  const items: MenuProps['items'] = navigation.map(item => item.views.length ? {
    key: groupKey(item.key), label: item.label, icon: <span aria-hidden="true">{navigationIcon(item.key)}</span>,
    children: item.views.map(view => ({ key: view.key, label: view.label, icon: <span aria-hidden="true">{navigationIcon(view.key)}</span> })),
  } : { key: item.key, label: item.label, icon: <span aria-hidden="true">{navigationIcon(item.key)}</span> });

  return <Layout className="inherited-admin-shell">
    {narrow && mobileOpen ? <button type="button" className="inherited-admin-shade" aria-label="关闭导航" onClick={() => { setMobileOpen(false); toggle.current?.focus(); }} /> : null}
    <Layout.Sider
      className="inherited-admin-sider" breakpoint="lg" collapsedWidth={0} width={248}
      collapsed={hidden} trigger={null}
      onBreakpoint={broken => { setNarrow(broken); setMobileOpen(false); }}
    >
      <div className="inherited-admin-sider-inner" inert={hidden ? true : undefined} aria-hidden={hidden ? true : undefined}>
        <div className="inherited-admin-brand">宁达订阅运营中台</div>
        <div className="inherited-admin-menu-scroll" data-testid="admin-menu-scroll" ref={menuScroll}
          onScroll={event => { scrollTop.current = event.currentTarget.scrollTop; remember(); }}>
          <nav id="inherited-admin-navigation" aria-label="主导航">
            <Menu mode="inline" inlineCollapsed={false} theme="dark" items={items} selectedKeys={leafKeys.has(routeKey) ? [routeKey] : []} openKeys={validOpenKeys}
              onOpenChange={keys => { const next = keys.filter(key => allowedGroups.has(key)); setOpenKeys(next); remember(next); }}
              onClick={({ key }) => { if (leafKeys.has(key)) { onNavigate(key); setMobileOpen(false); } }} />
          </nav>
        </div>
      </div>
    </Layout.Sider>
    <Layout className="inherited-admin-right">
      <Layout.Header className="inherited-admin-header">
        <Space className="inherited-admin-heading" size={12}>
          <Button ref={toggle} type="text" className="inherited-admin-mobile-toggle" aria-label={mobileOpen ? '收起导航' : '打开导航'} aria-controls="inherited-admin-navigation" aria-expanded={mobileOpen}
            icon={mobileOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />} onClick={() => setMobileOpen(value => !value)} />
          <Typography.Title level={4} className="inherited-admin-title">宁达订阅运营中台</Typography.Title>
        </Space>
        <Space size={8} className="inherited-admin-account">
          <Tag color="blue">{roleLabel}</Tag>
          <Typography.Text className="inherited-admin-username" ellipsis title={userName}>{userName}</Typography.Text>
          <Button type="text" size="small" icon={<LogoutOutlined />} onClick={onLogout} aria-label="退出登录"><span className="inherited-admin-logout-label">退出登录</span></Button>
        </Space>
      </Layout.Header>
      <Layout.Content id="main-content" className="inherited-admin-content main-content" data-testid="admin-content-scroll" onClick={onContentClick}>{children}</Layout.Content>
    </Layout>
  </Layout>;
}
