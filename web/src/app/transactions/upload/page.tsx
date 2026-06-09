'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Upload, FileSpreadsheet, ArrowLeft, CheckCircle2, AlertTriangle, X, Loader2, Download,
} from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import PageHero from '@/components/layout/PageHero';
import { Badge } from '@/components/ui/Pill';
import { cn } from '@/lib/utils';

const REQUIRED_FIELDS = ['employee_id', 'customer_id', 'product_id', 'transaction_type', 'quantity', 'amount', 'transaction_date', 'period'];
const OPTIONAL_FIELDS = ['territory_id'];
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

const SAMPLE_CSV = [
  [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].join(','),
  'EMP-001,CUST-100,SKU-9001,sale,5,1250.00,2026-05-12,2026-05,T-RIYADH',
  'EMP-001,CUST-100,SKU-9001,return,1,250.00,2026-05-13,2026-05,T-RIYADH',
  'EMP-002,CUST-205,SKU-7700,sale,12,3600.00,2026-05-14,2026-05,T-JEDDAH',
].join('\n');

const BATCH_SIZE = 500;

/** Tiny CSV parser — handles quoted fields with embedded commas, quotes, and \r\n line endings. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { cur.push(field); field = ''; }
      else if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else { field += ch; }
    }
  }
  if (field !== '' || cur.length > 0) { cur.push(field); rows.push(cur); }
  // Drop trailing all-empty rows
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

type ParseResult = {
  headers: string[];
  rows: string[][];
  fileName: string;
} | null;

export default function BulkUploadPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseResult>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [imported, setImported] = useState(0);
  const [failed, setFailed] = useState(0);
  const [progress, setProgress] = useState(0);     // 0..1

  const handleFile = async (file: File) => {
    setParseError(null);
    setImported(0);
    setFailed(0);
    setProgress(0);
    try {
      const text = await file.text();
      const all = parseCsv(text);
      if (all.length < 2) {
        setParseError('CSV needs a header row plus at least one data row.');
        setParsed(null);
        return;
      }
      const headers = all[0].map((h) => h.trim().toLowerCase());
      setParsed({ headers, rows: all.slice(1), fileName: file.name });
    } catch (e: any) {
      setParseError(e.message ?? 'Failed to read file.');
      setParsed(null);
    }
  };

  const missingRequired = useMemo(() => {
    if (!parsed) return [] as string[];
    return REQUIRED_FIELDS.filter((f) => !parsed.headers.includes(f));
  }, [parsed]);
  const unknownColumns = useMemo(() => {
    if (!parsed) return [] as string[];
    return parsed.headers.filter((h) => !ALL_FIELDS.includes(h));
  }, [parsed]);

  const upload = async () => {
    if (!parsed || missingRequired.length > 0) return;
    setUploading(true);
    setImported(0);
    setFailed(0);
    setProgress(0);

    const batches: any[][] = [];
    for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
      const slice = parsed.rows.slice(i, i + BATCH_SIZE);
      const batch = slice.map((row) => {
        const fields: Record<string, any> = {};
        parsed.headers.forEach((h, idx) => {
          const raw = row[idx] ?? '';
          if (h === 'quantity' || h === 'amount') fields[h] = raw === '' ? 0 : Number(raw);
          else fields[h] = raw;
        });
        return { fields };
      });
      batches.push(batch);
    }

    let ok = 0, bad = 0;
    for (let i = 0; i < batches.length; i++) {
      try {
        const res = await api.post<unknown, { imported: number }>('/bulk/transactions', batches[i]);
        ok += res?.imported ?? batches[i].length;
      } catch (e: any) {
        bad += batches[i].length;
      }
      setImported(ok);
      setFailed(bad);
      setProgress((i + 1) / batches.length);
    }

    setUploading(false);
    if (bad === 0) toast.success(`Imported ${ok.toLocaleString()} transactions`);
    else toast.error(`Imported ${ok.toLocaleString()}; ${bad.toLocaleString()} failed`);
  };

  const reset = () => {
    setParsed(null);
    setParseError(null);
    setImported(0);
    setFailed(0);
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transactions-sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHero
        title="Bulk Upload"
        subtitle="Import sales, returns, collections from CSV."
        accessory={
          <Link href="/transactions" className="btn-ghost btn-sm">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to ledger
          </Link>
        }
        actions={
          <button onClick={downloadSample} className="btn-outline btn-sm">
            <Download className="h-3.5 w-3.5" /> Sample CSV
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4 min-w-0">
          {/* Dropzone */}
          {!parsed ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
              className={cn(
                'card p-10 border-2 border-dashed text-center cursor-pointer transition-colors',
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-line hover:border-primary/40 hover:bg-muted/30'
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Upload className="w-7 h-7" />
              </div>
              <div className="text-base font-semibold">Drop a CSV file here</div>
              <div className="text-sm text-fg-muted mt-1">or click to browse</div>
              {parseError && (
                <div className="mt-4 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 inline-block">
                  {parseError}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* File summary */}
              <section className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted text-foreground flex items-center justify-center">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{parsed.fileName}</div>
                  <div className="text-xs text-fg-muted">
                    {parsed.rows.length.toLocaleString()} rows · {parsed.headers.length} columns
                  </div>
                </div>
                <button onClick={reset} className="btn-ghost btn-sm" aria-label="Remove file">
                  <X className="w-3.5 h-3.5" /> Remove
                </button>
              </section>

              {/* Validation */}
              <section className="card p-4 space-y-3">
                <div className="text-sm font-semibold">Column check</div>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_FIELDS.map((f) => {
                    const present = parsed.headers.includes(f);
                    const required = REQUIRED_FIELDS.includes(f);
                    return (
                      <Badge
                        key={f}
                        tone={present ? 'success' : required ? 'danger' : 'soft'}
                      >
                        {present ? <CheckCircle2 className="w-3 h-3" /> : required ? <AlertTriangle className="w-3 h-3" /> : null}
                        {f}{required && !present ? ' (missing)' : ''}
                      </Badge>
                    );
                  })}
                </div>
                {unknownColumns.length > 0 && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    <strong className="font-semibold">Ignored columns:</strong> {unknownColumns.join(', ')}
                  </div>
                )}
                {missingRequired.length > 0 && (
                  <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                    Required columns missing: <strong className="font-semibold">{missingRequired.join(', ')}</strong>
                  </div>
                )}
              </section>

              {/* Preview */}
              <section className="card overflow-hidden">
                <header className="px-4 py-3 border-b text-sm font-semibold">Preview · first 10 rows</header>
                <div className="overflow-x-auto">
                  <table className="w-full text-2xs">
                    <thead className="bg-muted/40 text-fg-muted uppercase tracking-wider">
                      <tr>
                        {parsed.headers.map((h) => (
                          <th key={h} className={cn(
                            'text-left px-3 py-2 font-medium whitespace-nowrap',
                            !ALL_FIELDS.includes(h) && 'text-amber-700',
                            REQUIRED_FIELDS.includes(h) && 'text-fg'
                          )}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 10).map((row, ri) => (
                        <tr key={ri} className="border-t border-line/60">
                          {parsed.headers.map((_, ci) => (
                            <td key={ci} className="px-3 py-1.5 font-mono text-fg-muted whitespace-nowrap truncate max-w-[160px]">
                              {row[ci]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Upload action */}
              <section className="card p-4 space-y-3">
                {uploading || progress > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-fg-muted">
                      <span>
                        {uploading ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…
                          </span>
                        ) : 'Done'}
                      </span>
                      <span className="tabular-nums">{Math.round(progress * 100)}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />
                        {imported.toLocaleString()} imported
                      </span>
                      {failed > 0 && (
                        <span className="text-rose-700">
                          <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                          {failed.toLocaleString()} failed
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center justify-between">
                  <div className="text-xs text-fg-muted">
                    Uploads in batches of {BATCH_SIZE.toLocaleString()} rows.
                  </div>
                  <button
                    onClick={upload}
                    disabled={uploading || missingRequired.length > 0}
                    className="btn-primary"
                  >
                    <Upload className="w-4 h-4" />
                    {uploading ? 'Uploading…' : `Import ${parsed.rows.length.toLocaleString()} rows`}
                  </button>
                </div>
              </section>
            </>
          )}
        </div>

        {/* Sidebar tips */}
        <aside className="space-y-3">
          <div className="card p-4">
            <div className="eyebrow mb-2">Required columns</div>
            <ul className="text-xs space-y-1 font-mono">
              {REQUIRED_FIELDS.map((f) => (
                <li key={f} className="text-fg">{f}</li>
              ))}
            </ul>
            <div className="eyebrow mt-4 mb-2">Optional</div>
            <ul className="text-xs space-y-1 font-mono">
              {OPTIONAL_FIELDS.map((f) => (
                <li key={f} className="text-fg-muted">{f}</li>
              ))}
            </ul>
          </div>
          <div className="card p-4 text-xs text-fg-muted">
            <div className="eyebrow mb-2">Notes</div>
            <ul className="space-y-1.5 list-disc list-inside leading-relaxed">
              <li><span className="font-mono text-fg">transaction_type</span>: sale, return, collection or event</li>
              <li><span className="font-mono text-fg">period</span>: YYYY-MM (e.g. 2025-05)</li>
              <li><span className="font-mono text-fg">transaction_date</span>: ISO date (YYYY-MM-DD)</li>
              <li>Header row is required and lower-cased before matching</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
