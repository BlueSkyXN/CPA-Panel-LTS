import { useState } from 'react';

type Row = { id: string; key: number; isNew: boolean };
type Identity = { rows: Row[]; nextKey: number };

export function reconcileRuleIdentity(previous: Identity, ids: readonly string[]): Identity {
  const remaining = [...previous.rows];
  let nextKey = previous.nextKey;
  const rows = ids.map((id) => {
    const index = remaining.findIndex((row) => row.id === id);
    return index < 0 ? { id, key: nextKey++, isNew: true } : remaining.splice(index, 1)[0];
  });
  return { rows, nextKey };
}

// Keys belong to the editor session, not to editable Core rule IDs or YAML.
export function useRuleIdentity(ids: readonly string[]) {
  const [identity, setIdentity] = useState<Identity>(() => ({
    rows: ids.map((id, key) => ({ id, key, isNew: false })),
    nextKey: ids.length,
  }));
  let current = identity;
  if (identity.rows.length !== ids.length || identity.rows.some((row, i) => row.id !== ids[i])) {
    current = reconcileRuleIdentity(identity, ids);
    setIdentity(current);
  }
  return {
    rows: current.rows,
    rename: (index: number, id: string) =>
      setIdentity((old) => ({
        ...old,
        rows: old.rows.map((row, i) => (i === index ? { ...row, id } : row)),
      })),
    remove: (index: number) =>
      setIdentity((old) => ({
        ...old,
        rows: old.rows.filter((_, i) => i !== index),
      })),
  };
}
