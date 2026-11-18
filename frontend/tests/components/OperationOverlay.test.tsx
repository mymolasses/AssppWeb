import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OperationOverlay from '../../src/components/common/OperationOverlay';
import { useOperations, withOperation } from '../../src/store/operations';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
describe('operation loading interface', () => {
  it('shows a pending action and dismisses after success', async () => {
    render(<OperationOverlay />);
    let done!: () => void;
    let work!: Promise<void>;
    act(() => {
      work = withOperation(
        'purchase',
        () =>
          new Promise<void>((resolve) => {
            done = resolve;
          }),
      );
    });
    expect(screen.getByRole('dialog', { name: 'operation.purchase' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      done();
      await work;
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('clears errors without hiding another pending request', async () => {
    let done!: () => void;
    const pending = withOperation(
      'versions',
      () =>
        new Promise<void>((resolve) => {
          done = resolve;
        }),
    );
    await expect(
      withOperation('login', async () => {
        throw new Error('fixture');
      }),
    ).rejects.toThrow('fixture');
    expect(useOperations.getState().active.map((op) => op.kind)).toEqual(['versions']);
    done();
    await pending;
    expect(useOperations.getState().active).toEqual([]);
  });
});
