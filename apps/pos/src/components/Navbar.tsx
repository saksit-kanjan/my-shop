import { NavLink } from 'react-router-dom';
import { storeInfo } from '../data/demo-catalog';
import { useCart } from '../store/cart';
import { useSession } from '../store/session';

const link = ({ isActive }: { isActive: boolean }) => `btn ${isActive ? 'btn-neutral' : 'btn-ghost'}`;

export function Navbar() {
  const employee = useSession((s) => s.employee);
  const heldCount = useCart((s) => s.held.length);
  return (
    <header className="navbar min-h-0 bg-base-100 border-b border-base-300 px-4 py-2 gap-2 flex-wrap">
      <div className="flex-1 flex items-center gap-3 flex-wrap">
        <span className="text-lg font-semibold">{storeInfo.storeName}</span>
        <span className="badge badge-ghost">{storeInfo.terminalId}</span>
      </div>
      <nav aria-label="เมนู POS" className="flex flex-wrap items-center gap-1">
        <NavLink to="/sale" className={link}>หน้าขาย</NavLink>
        <NavLink to="/held" className={link}>
          บิลที่พัก {heldCount > 0 && <span className="badge badge-sm badge-primary">{heldCount}</span>}
        </NavLink>
        <NavLink to="/refund" className={link}>คืนสินค้า</NavLink>
        <NavLink to="/cash" className={link}>เงินเข้า/ออก</NavLink>
        <NavLink to="/close-shift" className={link}>ปิดกะ</NavLink>
        {employee && (
          <span className="flex items-center gap-2 pl-3 ml-1 border-l border-base-300">
            <span className="bg-neutral text-neutral-content w-9 h-9 rounded-full grid place-items-center text-sm">{employee.initials}</span>
            <span className="text-sm">{employee.name}</span>
          </span>
        )}
      </nav>
    </header>
  );
}
