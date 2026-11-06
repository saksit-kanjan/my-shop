import type { Permission } from '@my-shop/contracts';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { ApiError } from '../api/http-pos-api';
import { Keypad, applyKey } from './Keypad';

const LABEL: Partial<Record<Permission, string>> = {
  void: 'ยกเลิกบิล',
  refund: 'คืนสินค้า',
  'refund.late': 'คืนสินค้าเกินกำหนด (ต้องผู้จัดการ)',
  'drawer.nosale': 'เปิดลิ้นชักโดยไม่ขาย',
  'shift.expected': 'ปิดกะที่เงินขาดหรือเกิน',
  'discount.over_cap': 'ส่วนลดเกินเพดาน',
};

interface Ask {
  permission: Permission;
  resolve: (code: string | null) => void;
}

/**
 * A supervisor types their own 6-digit code at this till to approve something (rule 8). `run` does the action,
 * and when the server answers "needs approval" it asks for the code and tries once more with it.
 */
export function useApproval(): { run: <T>(action: (approverCode?: string) => Promise<T>) => Promise<T | undefined>; dialog: ReactNode } {
  const ref = useRef<HTMLDialogElement>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const askCode = useCallback(
    (permission: Permission) =>
      new Promise<string | null>((resolve) => {
        setCode('');
        setError('');
        setAsk({ permission, resolve });
        ref.current?.showModal();
      }),
    [],
  );

  const finish = (value: string | null) => {
    ref.current?.close();
    ask?.resolve(value);
    setAsk(null);
  };

  const submit = async (c: string) => {
    if (!ask || busy) return;
    setBusy(true);
    try {
      await api.checkApproval(ask.permission, c);
      finish(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ตรวจรหัสไม่สำเร็จ ลองอีกครั้ง');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const press = (key: string) => {
    if (busy) return;
    setError('');
    const next = applyKey(code, key, 6);
    setCode(next);
    if (next.length === 6) void submit(next);
  };

  const run = useCallback(
    async <T,>(action: (approverCode?: string) => Promise<T>): Promise<T | undefined> => {
      let approverCode: string | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await action(approverCode);
        } catch (e) {
          const needs = e instanceof ApiError && e.code === 'forbidden' ? (e.details?.['needsApproval'] as Permission | undefined) : undefined;
          if (!needs) throw e;
          const got = await askCode(needs);
          if (!got) return undefined;
          approverCode = got;
        }
      }
      return undefined;
    },
    [askCode],
  );

  const dialog = (
    <dialog ref={ref} className="modal" aria-labelledby="approval-title" onCancel={() => finish(null)}>
      <div className="modal-box flex flex-col gap-3 max-w-sm">
        <h2 id="approval-title" className="text-lg font-semibold">ต้องให้หัวหน้ากะอนุมัติ</h2>
        <p className="text-sm opacity-70">{ask ? LABEL[ask.permission] ?? 'รายการนี้' : ''} · ให้หัวหน้ากะกดรหัสพนักงานของตัวเอง</p>
        <div className="flex justify-center gap-3 py-1" role="status" aria-label={`กดแล้ว ${code.length} จาก 6 หลัก`}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={i < code.length ? 'w-4 h-4 rounded-full bg-primary' : 'w-4 h-4 rounded-full border-2 border-base-300'} />
          ))}
        </div>
        <div className="h-5 text-sm text-error text-center" aria-live="polite">{error}</div>
        <Keypad onKey={press} />
        <div className="modal-action mt-0">
          <button type="button" className="btn btn-ghost" onClick={() => finish(null)}>ยกเลิก</button>
        </div>
      </div>
    </dialog>
  );

  return { run, dialog };
}
