// src/utils/exportUtils.ts
// npm install jspdf jspdf-autotable xlsx

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export interface ExportColumn { header: string; key: string; align?: 'left' | 'right' | 'center'; }
export interface ExportRow { [key: string]: string | number; }

export function exportToPDF(title: string, subtitle: string, columns: ExportColumn[], rows: ExportRow[], filename: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 16);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
  doc.text(subtitle, 14, 22); doc.setTextColor(0);
  const columnStyles: Record<number, object> = {};
  columns.forEach((c, i) => {
    if (c.align === 'right') columnStyles[i] = { halign: 'right' };
    else if (c.align === 'center') columnStyles[i] = { halign: 'center' };
  });
  autoTable(doc, {
    startY: 27,
    head: [columns.map(c => c.header)],
    body: rows.map(r => columns.map(c => String(r[c.key] ?? ''))),
    columnStyles,
    headStyles: { fillColor: [26, 25, 23], textColor: [245, 244, 240], fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [248, 247, 242] },
    margin: { left: 14, right: 14 },
  });
  doc.save(`${filename}.pdf`);
}

export function exportToExcel(sheetName: string, columns: ExportColumn[], rows: ExportRow[], filename: string) {
  const wsData: (string | number)[][] = [
    columns.map(c => c.header),
    ...rows.map(r => columns.map(c => {
      const v = r[c.key];
      if (typeof v === 'number') return v;
      const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
      return isNaN(n) ? String(v ?? '') : n;
    })),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = columns.map((_, ci) =>
    ({ wch: Math.max(...wsData.map(row => String(row[ci] ?? '').length)) + 2 })
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
