// src/components/ProductSearch.tsx
import { useState, useRef, useEffect } from 'react';
import type { Product } from '../types';
import { createProduct } from '../api';
import styles from './SellerSearch.module.css'; // reuse same styles

interface Props {
  companyId: number;
  products: Product[];
  onSelect: (p: Product) => void;
  onProductCreated: (p: Product) => void;
  placeholder?: string;
}

export default function ProductSearch({ companyId, products, onSelect, onProductCreated, placeholder }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
    : [];

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const select = (p: Product) => {
    onSelect(p); setQuery(''); setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (filtered.length === 1) { select(filtered[0]); return; }
      if (filtered.length === 0 && query.trim()) {
        setShowNewModal(true); setOpen(false); setError('');
      }
    }
    if (e.key === 'Escape') setOpen(false);
  };

  const handleCreate = async () => {
    if (!query.trim()) return;
    try {
      const p = await createProduct(companyId, { name: query.trim() });
      onProductCreated(p);
      select(p);
      setShowNewModal(false);
    } catch (e: any) {
      setError((e as Error).message);
    }
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <input
        className={styles.input}
        placeholder={placeholder ?? 'Caută produs...'}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul className={styles.dropdown}>
          {filtered.map(p => (
            <li key={p.id} className={styles.option} onMouseDown={() => select(p)}>
              <span className={styles.optName}>{p.name}</span>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() && filtered.length === 0 && (
        <div className={styles.noMatch}>
          „{query}" — produs nou. Apasă Enter.
        </div>
      )}

      {showNewModal && (
        <div className={styles.backdrop} onMouseDown={e => e.target === e.currentTarget && setShowNewModal(false)}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Produs nou</h3>
            <div className={styles.field}>
              <label className={styles.label}>Denumire</label>
              <div className={styles.staticValue}>{query}</div>
            </div>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button className={styles.btnCancel} onClick={() => setShowNewModal(false)}>Anulare</button>
              <button className={styles.btnConfirm} onClick={handleCreate}>Adaugă</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
