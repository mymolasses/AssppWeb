import { create } from 'zustand';

export type OperationKind = 'login' | 'purchase' | 'download' | 'versions' | 'metadata' | 'search';
interface Operation {
  id: string;
  kind: OperationKind;
  started: number;
  detail?: string;
  mode?: 'browser' | 'native';
}
export const useOperations = create<{ active: Operation[]; set: (active: Operation[]) => void }>((set) => ({
  active: [],
  set: (active) => set({ active }),
}));

let sequence = 0;
export function updateOperation(detail: string) {
  const state = useOperations.getState();
  state.set(state.active.map((item, index) => (index === state.active.length - 1 ? { ...item, detail } : item)));
}

export async function withOperation<T>(
  kind: OperationKind,
  work: () => Promise<T>,
  mode?: 'browser' | 'native',
): Promise<T> {
  const id = Date.now().toString(36) + '-' + ++sequence;
  const state = useOperations.getState();
  state.set([...state.active, { id, kind, started: Date.now(), mode }]);
  try {
    return await work();
  } finally {
    const latest = useOperations.getState();
    latest.set(latest.active.filter((item) => item.id !== id));
  }
}
