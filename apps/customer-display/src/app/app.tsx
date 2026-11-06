import { CartScreen } from '../screens/CartScreen';
import { IdleScreen } from '../screens/IdleScreen';
import { PayScreen } from '../screens/PayScreen';
import { SummaryScreen } from '../screens/SummaryScreen';
import { ThanksScreen } from '../screens/ThanksScreen';
import { useDisplayState } from './use-display-state';

export function App() {
  const state = useDisplayState();

  return (
    <div className="h-screen flex flex-col bg-base-200 text-base-content">
      <header className="flex items-center justify-between px-8 py-5">
        <span className="text-2xl font-semibold">{state?.storeName ?? 'My Shop'}</span>
        {state && <span className="text-lg opacity-70">สาขา {state.branchName}</span>}
      </header>
      {!state && <IdleScreen showcase={[]} waiting />}
      {state?.phase === 'idle' && <IdleScreen showcase={state.promoShowcase} />}
      {state?.phase === 'cart' && state.cart && <CartScreen state={state} />}
      {state?.phase === 'offers' && state.cart && <SummaryScreen state={state} />}
      {state?.phase === 'pay' && <PayScreen state={state} />}
      {state?.phase === 'thanks' && <ThanksScreen state={state} />}
    </div>
  );
}

export default App;
