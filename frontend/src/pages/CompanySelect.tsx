import { useEffect, useState } from 'react';
import { getCompanies, createCompany } from '../api';
import type { Company } from '../types';
import styles from './CompanySelect.module.css';

const BASE = 'http://localhost:8000';

interface Props {
  onSelect: (company: Company) => void;
}

type ModalMode = 'create' | 'edit' | 'delete' | null;

export default function CompanySelect({ onSelect }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [targetCompany, setTargetCompany] = useState<Company | null>(null);
  const [form, setForm] = useState({ name: '', tax_id: '', chamber_id: '', opening_stock: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCompanies().then(setCompanies).finally(() => setLoading(false));
  }, []);

  const openCreate = () => {
    setForm({ name: '', tax_id: '', chamber_id: '', opening_stock: '' });
    setError('');
    setTargetCompany(null);
    setModalMode('create');
  };

  const openEdit = (c: Company, e: React.MouseEvent) => {
    e.stopPropagation();
    setForm({
      name: c.name,
      tax_id: c.tax_id,
      chamber_id: c.chamber_id ?? '',
      opening_stock: String(c.opening_stock),
    });
    setError('');
    setTargetCompany(c);
    setModalMode('edit');
  };

  const openDelete = (c: Company, e: React.MouseEvent) => {
    e.stopPropagation();
    setTargetCompany(c);
    setError('');
    setModalMode('delete');
  };

  const closeModal = () => {
    setModalMode(null);
    setTargetCompany(null);
    setError('');
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.tax_id.trim()) {
      setError('Denumirea și CUI-ul sunt obligatorii.');
      return;
    }
    try {
      const company = await createCompany({
        name: form.name.trim(),
        tax_id: form.tax_id.trim(),
        chamber_id: form.chamber_id.trim() || undefined,
        opening_stock: parseFloat(form.opening_stock) || 0,
      });
      setCompanies(prev => [...prev, company]);
      closeModal();
      onSelect(company);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleEdit = async () => {
    if (!form.name.trim() || !form.tax_id.trim()) {
      setError('Denumirea și CUI-ul sunt obligatorii.');
      return;
    }
    if (!targetCompany) return;
    try {
      const res = await fetch(`${BASE}/companies/${targetCompany.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          tax_id: form.tax_id.trim(),
          chamber_id: form.chamber_id.trim() || undefined,
          opening_stock: parseFloat(form.opening_stock) || 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const updated: Company = await res.json();
      setCompanies(prev => prev.map(c => c.id === updated.id ? updated : c));
      closeModal();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async () => {
    if (!targetCompany) return;
    try {
      const res = await fetch(`${BASE}/companies/${targetCompany.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      setCompanies(prev => prev.filter(c => c.id !== targetCompany.id));
      closeModal();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (modalMode === 'create') handleCreate();
      else if (modalMode === 'edit') handleEdit();
    }
    if (e.key === 'Escape') closeModal();
  };

  return (
    <div className={styles.page}>
      <div className={styles.left}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>◆</span>
          <span className={styles.brandName}>Evidența stocurilor</span>
        </div>
        <p className={styles.tagline}>
          Selectați sau creați o companie pentru a continua.
        </p>
      </div>

      <div className={styles.right}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Companii</h2>
            <button className={styles.btnNew} onClick={openCreate}>
              + Companie nouă
            </button>
          </div>

          {loading ? (
            <div className={styles.empty}>Se încarcă...</div>
          ) : companies.length === 0 ? (
            <div className={styles.empty}>Nicio companie înregistrată.</div>
          ) : (
            <ul className={styles.list}>
              {companies.map(c => (
                <li key={c.id} className={styles.listItem}>
                  <div className={styles.listClickable} onClick={() => onSelect(c)}>
                    <div className={styles.listMain}>
                      <span className={styles.listName}>{c.name}</span>
                      <span className={styles.listSub}>
                        {c.tax_id}{c.chamber_id ? ` · ${c.chamber_id}` : ''}
                      </span>
                    </div>
                    <span className={styles.listArrow}>→</span>
                  </div>
                  <div className={styles.listActions}>
                    <button
                      className={styles.iconBtn}
                      title="Editează"
                      onClick={e => openEdit(c, e)}
                    >
                      ✎
                    </button>
                    <button
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      title="Șterge"
                      onClick={e => openDelete(c, e)}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Create / Edit modal */}
      {(modalMode === 'create' || modalMode === 'edit') && (
        <div
          className={styles.modalBackdrop}
          onClick={e => e.target === e.currentTarget && closeModal()}
          onKeyDown={handleKeyDown}
        >
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>
              {modalMode === 'create' ? 'Companie nouă' : 'Editează compania'}
            </h3>

            <label className={styles.label}>Denumire *</label>
            <input
              className={styles.input}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="ex. SC Exemplu SRL"
              autoFocus
            />

            <label className={styles.label}>CUI / Tax ID *</label>
            <input
              className={`${styles.input} ${styles.mono}`}
              value={form.tax_id}
              onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))}
              placeholder="ex. RO12345678"
            />

            <label className={styles.label}>Nr. Reg. Comerț</label>
            <input
              className={styles.input}
              value={form.chamber_id}
              onChange={e => setForm(f => ({ ...f, chamber_id: e.target.value }))}
              placeholder="ex. J40/1234/2020"
            />

            <label className={styles.label}>Stoc inițial (la prețul de vânzare)</label>
            <input
              className={`${styles.input} ${styles.mono}`}
              type="number"
              min="0"
              step="0.01"
              value={form.opening_stock}
              onChange={e => setForm(f => ({ ...f, opening_stock: e.target.value }))}
              placeholder="0.00"
            />

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.modalActions}>
              <button className={styles.btnCancel} onClick={closeModal}>Anulare</button>
              <button
                className={styles.btnConfirm}
                onClick={modalMode === 'create' ? handleCreate : handleEdit}
              >
                {modalMode === 'create' ? 'Creează' : 'Salvează'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {modalMode === 'delete' && targetCompany && (
        <div
          className={styles.modalBackdrop}
          onClick={e => e.target === e.currentTarget && closeModal()}
        >
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Șterge compania</h3>
            <p className={styles.confirmBody}>
              Ești sigur că vrei să ștergi{' '}
              <span className={styles.confirmName}>{targetCompany.name}</span>?
              Această acțiune va șterge toate tranzacțiile și datele asociate și nu poate fi anulată.
            </p>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.modalActions}>
              <button className={styles.btnCancel} onClick={closeModal}>Anulare</button>
              <button className={styles.btnDanger} onClick={handleDelete}>Șterge definitiv</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
