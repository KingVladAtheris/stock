import { useState, useRef, useEffect } from 'react';
import type { Seller } from '../types';
import { createSeller } from '../api';
import styles from './SellerSearch.module.css';

interface Props {
  sellers: Seller[];
  onSelect: (seller: Seller) => void;
  onSellerCreated: (seller: Seller) => void;
}

export default function SellerSearch({ sellers, onSelect, onSellerCreated }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTaxId, setNewTaxId] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim().length > 0
    ? sellers.filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
    : [];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (filtered.length === 1) {
        select(filtered[0]);
      } else if (filtered.length === 0 && query.trim()) {
        setShowNewModal(true);
        setOpen(false);
        setNewTaxId('');
        setError('');
      }
    }
    if (e.key === 'Escape') setOpen(false);
  };

  const select = (seller: Seller) => {
    onSelect(seller);
    setQuery('');
    setOpen(false);
  };

  const handleCreate = async () => {
    if (!newTaxId.trim()) { setError('Tax ID este obligatoriu.'); return; }
    try {
      const seller = await createSeller({ name: query.trim(), tax_id: newTaxId.trim() });
      onSellerCreated(seller);
      select(seller);
      setShowNewModal(false);
      setQuery('');
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className={styles.wrap} ref={dropRef}>
      <input
        ref={inputRef}
        className={styles.input}
        placeholder="Adaugă furnizor..."
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul className={styles.dropdown}>
          {filtered.map(s => (
            <li key={s.id} className={styles.option} onMouseDown={() => select(s)}>
              <span className={styles.optName}>{s.name}</span>
              <span className={styles.optTax}>{s.tax_id}</span>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() && filtered.length === 0 && (
        <div className={styles.noMatch}>
          <span>"{query}" — furnizor nou. Apasă Enter.</span>
        </div>
      )}

      {showNewModal && (
        <div className={styles.backdrop} onMouseDown={e => e.target === e.currentTarget && setShowNewModal(false)}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Furnizor nou</h3>
            <div className={styles.field}>
              <label className={styles.label}>Denumire</label>
              <div className={styles.staticValue}>{query}</div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CUI / Tax ID *</label>
              <input
                className={styles.modalInput}
                value={newTaxId}
                onChange={e => setNewTaxId(e.target.value)}
                placeholder="ex. RO12345678"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
            </div>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button className={styles.btnCancel} onClick={() => setShowNewModal(false)}>Anulare</button>
              <button className={styles.btnConfirm} onClick={handleCreate}>Acceptă</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
