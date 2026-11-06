import type { Permission, Role } from '@my-shop/contracts';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { SESSION_EXPIRED, api, hasToken, setToken, type Settings } from '../api';
import { AuditPage } from '../pages/Audit';
import { CountPage } from '../pages/Count';
import { DashboardPage } from '../pages/Dashboard';
import { DayClosePage } from '../pages/DayClose';
import { DocumentsPage } from '../pages/Documents';
import { LoginPage } from '../pages/Login';
import { MembersPage } from '../pages/Members';
import { ProductsPage } from '../pages/Products';
import { PromosPage } from '../pages/Promos';
import { ReceivePage } from '../pages/Receive';
import { ReportsPage } from '../pages/Reports';
import { SettingsPage } from '../pages/Settings';
import { StockPage } from '../pages/Stock';
import { UsersPage } from '../pages/Users';

interface Session {
  employee: { id: string; name: string; initials: string; role: Role };
  permissions: Permission[];
  settings: Settings;
}

const Ctx = createContext<{ session: Session; can: (p: Permission) => boolean } | null>(null);
export const useSession = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside the signed-in layout');
  return c;
};

const ROLE_LABEL: Record<Role, string> = { cashier: 'แคชเชียร์', supervisor: 'หัวหน้ากะ', manager: 'ผู้จัดการ', owner: 'เจ้าของร้าน' };

interface Item {
  to: string;
  label: string;
  perm: Permission;
}
const MENU: { title?: string; items: Item[] }[] = [
  { items: [{ to: '/', label: 'Dashboard', perm: 'reports.all' }, { to: '/products', label: 'สินค้าและราคา', perm: 'stock.view' }, { to: '/promos', label: 'โปรโมชัน', perm: 'promos.manage' }, { to: '/members', label: 'สมาชิก', perm: 'members.manage' }] },
  { title: 'สต็อก', items: [{ to: '/stock', label: 'สต็อกคงเหลือ', perm: 'stock.view' }, { to: '/receive', label: 'รับสินค้า', perm: 'stock.view' }, { to: '/count', label: 'ตรวจนับสต็อก', perm: 'stock.view' }] },
  { title: 'การขาย', items: [{ to: '/day', label: 'กะและปิดวัน', perm: 'reports.all' }, { to: '/documents', label: 'เอกสารการขาย', perm: 'reports.all' }, { to: '/reports', label: 'รายงาน', perm: 'reports.all' }] },
  { title: 'ระบบ', items: [{ to: '/users', label: 'ผู้ใช้และสิทธิ์', perm: 'users.manage' }, { to: '/settings', label: 'ตั้งค่าร้าน', perm: 'settings.manage' }, { to: '/audit', label: 'Audit log', perm: 'audit.view' }] },
];

function Layout() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.me().then(setSession).catch((e: unknown) => setError(e instanceof Error ? e.message : 'โหลดข้อมูลผู้ใช้ไม่สำเร็จ'));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const out = () => navigate('/login');
    window.addEventListener(SESSION_EXPIRED, out);
    return () => window.removeEventListener(SESSION_EXPIRED, out);
  }, [navigate]);

  if (!hasToken()) return <Navigate to="/login" replace />;
  if (error) return <main className="min-h-screen grid place-items-center p-6"><div role="alert" className="alert alert-error alert-soft">{error}</div></main>;
  if (!session) return <main className="min-h-screen grid place-items-center opacity-70" role="status">กำลังโหลด…</main>;
  if (!session.permissions.some((p) => MENU.flatMap((g) => g.items).some((i) => i.perm === p))) {
    return <main className="min-h-screen grid place-items-center p-6"><div role="alert" className="alert alert-warning alert-soft">บัญชีนี้ยังไม่มีสิทธิ์ใช้งานหลังบ้าน</div></main>;
  }
  const can = (p: Permission) => session.permissions.includes(p);

  return (
    <Ctx.Provider value={{ session, can }}>
      <div className="min-h-screen flex flex-wrap bg-base-200 text-base-content">
        <aside className="bg-base-100 border-r border-base-300 p-3 flex flex-col gap-2 print:hidden" style={{ flex: '1 1 220px', maxWidth: 250 }}>
          <div className="px-3 py-2 flex flex-col">
            <span className="text-lg font-semibold">{session.settings.storeName}</span>
            <span className="text-xs opacity-70">หลังบ้าน · สาขา {session.settings.branchName}</span>
          </div>
          <nav aria-label="เมนูหลังบ้าน">
            <ul className="menu w-full gap-0.5 p-0">
              {MENU.map((g, gi) => {
                const items = g.items.filter((i) => can(i.perm));
                if (items.length === 0) return null;
                return [
                  g.title ? <li key={`t${gi}`} className="menu-title pt-3">{g.title}</li> : null,
                  ...items.map((i) => (
                    <li key={i.to}>
                      <NavLink to={i.to} end={i.to === '/'} className={({ isActive }) => (isActive ? 'menu-active' : '')}>{i.label}</NavLink>
                    </li>
                  )),
                ];
              })}
            </ul>
          </nav>
          <div className="mt-auto px-3 py-2 flex items-center gap-2 text-sm">
            <span className="bg-neutral text-neutral-content w-8 h-8 rounded-full grid place-items-center text-xs">{session.employee.initials}</span>
            <span className="flex flex-col flex-1"><span>{session.employee.name}</span><span className="text-xs opacity-70">{ROLE_LABEL[session.employee.role]}</span></span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => { void api.logout().catch(() => undefined); setToken(null); navigate('/login'); }}>ออก</button>
          </div>
        </aside>
        <main className="flex flex-col gap-4 p-8 print:p-0" style={{ flex: '999 1 560px', minWidth: 0 }}>
          <Outlet />
        </main>
      </div>
    </Ctx.Provider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="promos" element={<PromosPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="receive" element={<ReceivePage />} />
        <Route path="count" element={<CountPage />} />
        <Route path="day" element={<DayClosePage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
