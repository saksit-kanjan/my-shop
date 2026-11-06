import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';
import { Alert, errText } from '../ui';

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.login(username.trim(), password);
      setToken(r.token);
      navigate('/');
    } catch (e) {
      setError(errText(e, 'เข้าสู่ระบบไม่สำเร็จ ลองอีกครั้ง'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-base-200 grid place-items-center p-6">
      <form className="card bg-base-100 border border-base-300 w-full max-w-[400px] anim-in" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="card-body gap-4">
          <div className="flex flex-col"><span className="text-2xl font-semibold">My Shop</span><span className="text-sm opacity-70">เข้าสู่ระบบหลังบ้าน</span></div>
          <label className="flex flex-col gap-1"><span className="text-sm">ชื่อผู้ใช้</span><input autoFocus autoComplete="username" className="input w-full" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
          <label className="flex flex-col gap-1"><span className="text-sm">รหัสผ่าน</span><input type="password" autoComplete="current-password" className="input w-full" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <Alert>{error}</Alert>
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !username || !password}>เข้าสู่ระบบ</button>
          <span className="text-xs opacity-60">แคชเชียร์ใช้รหัสพนักงาน 6 หลักที่เครื่อง POS ไม่ใช่หน้านี้</span>
        </div>
      </form>
    </main>
  );
}
