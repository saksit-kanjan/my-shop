import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/http-pos-api';
import { Keypad, applyKey } from '../components/Keypad';
import { storeInfo } from '../data/demo-catalog';
import { useSession } from '../store/session';

const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 30;

export function LoginPage() {
  const login = useSession((s) => s.login);
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [message, setMessage] = useState('ไม่พบรหัสนี้ ลองใหม่อีกครั้ง');
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const locked = lockedUntil > now;

  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [locked]);

  const press = (key: string) => {
    if (locked) return;
    setError(false);
    setCode((c) => applyKey(error ? '' : c, key, CODE_LENGTH));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('ลบ');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (code.length !== CODE_LENGTH) return;
    void (async () => {
      let ok = false;
      try {
        ok = await login(code);
      } catch (e) {
        // The server counts wrong codes too; its lock (423) wins over this screen's own counter.
        if (e instanceof ApiError && e.status === 423) {
          setLockedUntil(Date.now() + LOCK_SECONDS * 1000);
          setNow(Date.now());
          setAttempts(0);
          setCode('');
          return;
        }
        setMessage(e instanceof Error ? e.message : 'เข้าสู่ระบบไม่สำเร็จ ลองอีกครั้ง');
        setError(true);
        return;
      }
      if (ok) {
        setMessage('ไม่พบรหัสนี้ ลองใหม่อีกครั้ง');
        const shiftId = useSession.getState().shiftId;
        navigate(shiftId ? '/sale' : '/open-shift');
        return;
      }
      const n = attempts + 1;
      setAttempts(n);
      setMessage('ไม่พบรหัสนี้ ลองใหม่อีกครั้ง');
      setError(true);
      if (n >= MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCK_SECONDS * 1000);
        setNow(Date.now());
        setAttempts(0);
      }
    })();
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const waitSeconds = Math.ceil((lockedUntil - now) / 1000);

  return (
    <main className="min-h-screen bg-base-200 flex items-center justify-center p-6">
      <div className="card bg-base-100 border border-base-300 w-full max-w-[420px] anim-in">
        <div className="card-body p-8 gap-5">
          <div className="flex justify-between items-baseline">
            <span className="text-2xl font-semibold">{storeInfo.storeName}</span>
            <span className="text-sm opacity-70">เครื่อง {storeInfo.terminalId}</span>
          </div>
          <div className="flex flex-col items-center gap-3 py-2">
            <span className="text-sm font-medium" id="code-label">กดรหัสพนักงาน 6 หลัก</span>
            <div className="flex gap-3" role="status" aria-labelledby="code-label" aria-label={`กดแล้ว ${code.length} จาก ${CODE_LENGTH} หลัก`}>
              {Array.from({ length: CODE_LENGTH }, (_, i) => (
                <span key={i} className={i < code.length ? `w-4 h-4 rounded-full ${error ? 'bg-error' : 'bg-primary'}` : 'w-4 h-4 rounded-full border-2 border-base-300'} />
              ))}
            </div>
            <div className="h-6 text-sm font-medium" aria-live="polite">
              {locked ? (
                <span className="text-error">กดผิดหลายครั้ง ลองใหม่ใน {waitSeconds} วินาที</span>
              ) : error ? (
                <span className="text-error anim-in">{message}</span>
              ) : null}
            </div>
          </div>
          <Keypad onKey={press} />
        </div>
      </div>
    </main>
  );
}
