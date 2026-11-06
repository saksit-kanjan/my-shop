import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { SESSION_EXPIRED_EVENT } from '../api';
import { Navbar } from '../components/Navbar';
import { useDisplaySync } from '../display/bridge';
import { CashMovePage } from '../pages/CashMove';
import { CloseShiftPage } from '../pages/CloseShift';
import { HeldPage } from '../pages/Held';
import { LoginPage } from '../pages/Login';
import { OffersPage } from '../pages/Offers';
import { OpenShiftPage } from '../pages/OpenShift';
import { PaymentPage } from '../pages/Payment';
import { RefundPage } from '../pages/Refund';
import { SalePage } from '../pages/Sale';
import { SuccessPage } from '../pages/Success';
import { ZReportPage } from '../pages/ZReport';
import { useCatalog } from '../store/catalog';
import { useSession } from '../store/session';

function RequireLogin({ children }: { children: ReactNode }) {
  const employee = useSession((s) => s.employee);
  return employee ? <>{children}</> : <Navigate to="/login" replace />;
}

/** Pages that need an open shift, wrapped in the POS navbar. */
function ShiftLayout() {
  const employee = useSession((s) => s.employee);
  const shiftId = useSession((s) => s.shiftId);
  if (!employee) return <Navigate to="/login" replace />;
  if (!shiftId) return <Navigate to="/open-shift" replace />;
  return (
    <div className="h-screen flex flex-col bg-base-200">
      <Navbar />
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        <Outlet />
      </div>
    </div>
  );
}

export function App() {
  const load = useCatalog((s) => s.load);
  const catalog = useCatalog((s) => s.catalog);
  const restoreShift = useSession((s) => s.restoreShift);

  useEffect(() => {
    void load();
    void restoreShift();
  }, [load, restoreShift]);

  // The server dropped our session (idle too long, or restarted): back to the keypad, no extra API call.
  useEffect(() => {
    const onExpired = () => useSession.setState({ employee: null, shiftId: null });
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useDisplaySync();

  if (!catalog) return <div className="min-h-screen grid place-items-center opacity-70">กำลังโหลดข้อมูลสินค้า…</div>;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/open-shift" element={<RequireLogin><OpenShiftPage /></RequireLogin>} />
      <Route path="/z-report" element={<div className="min-h-screen flex flex-col bg-base-200"><ZReportPage /></div>} />
      <Route element={<ShiftLayout />}>
        <Route path="/sale" element={<SalePage />} />
        <Route path="/offers" element={<OffersPage />} />
        <Route path="/payment" element={<PaymentPage />} />
        <Route path="/success" element={<SuccessPage />} />
        <Route path="/held" element={<HeldPage />} />
        <Route path="/refund" element={<RefundPage />} />
        <Route path="/cash" element={<CashMovePage />} />
        <Route path="/close-shift" element={<CloseShiftPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
