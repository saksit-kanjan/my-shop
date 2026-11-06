import type { DisplayMessage, DisplayState } from '@my-shop/contracts';
import { displayChannelName } from '@my-shop/contracts';
import { useEffect, useState } from 'react';

/** Terminal this display belongs to: ?terminal=T02 overrides the build-time default. */
export function terminalId(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('terminal');
  return fromQuery ?? (import.meta.env.VITE_TERMINAL_ID as string | undefined) ?? 'T01';
}

/** Latest state published by the POS on the same machine. */
export function useDisplayState(): DisplayState | null {
  const [state, setState] = useState<DisplayState | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(displayChannelName(terminalId()));
    ch.onmessage = (e: MessageEvent<DisplayMessage>) => {
      if (e.data?.type === 'state') setState(e.data.state);
    };
    ch.postMessage({ type: 'hello' } satisfies DisplayMessage);
    return () => ch.close();
  }, []);
  return state;
}
