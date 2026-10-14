import { File } from 'expo-file-system';
import { supabase } from '../supabaseConfig';
import { base64ToBytes } from '../utils/base64';

export type DocEntityType = 'driver' | 'vehicle';
export type DocType = 'license' | 'aadhaar' | 'pan' | 'insurance' | 'permit' | 'puc' | 'rc' | 'fitness' | 'other';

// Aadhaar/PAN documents are admin-only (RLS on documents and on the bucket).
export const PII_DOC_TYPES: DocType[] = ['aadhaar', 'pan'];
export const DOC_TYPES_BY_ENTITY: Record<DocEntityType, DocType[]> = {
  driver: ['license', 'aadhaar', 'pan', 'other'],
  vehicle: ['insurance', 'permit', 'puc', 'rc', 'fitness', 'other'],
};

export const DOCUMENTS_BUCKET = 'documents';

export interface ComplianceDocument {
  id: string;
  entityType: DocEntityType;
  entityId: string;
  docType: DocType;
  docPath?: string;
  expiryDate?: string;
  verified: boolean;
  createdAt?: string;
}

const mapRow = (row: any): ComplianceDocument => ({
  id: row.id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  docType: row.doc_type,
  docPath: row.doc_path ?? undefined,
  expiryDate: row.expiry_date ?? undefined,
  verified: !!row.verified,
  createdAt: row.created_at,
});

export const getDocuments = async (entityType: DocEntityType, entityId: string): Promise<ComplianceDocument[]> => {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
};

// Uploads the scan (optional) to documents/<entity_type>/<entity_id>/<doc_type>/
// and records the document; the folder layout is what the Storage policies check.
export const addDocument = async (doc: {
  entityType: DocEntityType;
  entityId: string;
  docType: DocType;
  expiryDate?: string;
  localUri?: string;
  createdBy?: string;
}): Promise<string> => {
  let docPath: string | null = null;
  if (doc.localUri) {
    const isPng = doc.localUri.toLowerCase().endsWith('.png');
    const isPdf = doc.localUri.toLowerCase().endsWith('.pdf');
    const ext = isPdf ? 'pdf' : isPng ? 'png' : 'jpg';
    docPath = `${doc.entityType}/${doc.entityId}/${doc.docType}/${Date.now()}.${ext}`;
    const bytes = base64ToBytes(await new File(doc.localUri).base64());
    const { error: uploadError } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(docPath, bytes, {
      contentType: isPdf ? 'application/pdf' : isPng ? 'image/png' : 'image/jpeg',
    });
    if (uploadError) throw uploadError;
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      entity_type: doc.entityType,
      entity_id: doc.entityId,
      doc_type: doc.docType,
      doc_path: docPath,
      expiry_date: doc.expiryDate || null,
      created_by: doc.createdBy ?? null,
    })
    .select('id')
    .single();
  if (error) {
    if (docPath) supabase.storage.from(DOCUMENTS_BUCKET).remove([docPath]).catch(() => {});
    throw error;
  }
  return data.id as string;
};

export const setDocumentVerified = async (id: string, verified: boolean) => {
  const { error } = await supabase.from('documents').update({ verified }).eq('id', id);
  if (error) throw error;
};

export const deleteDocument = async (doc: ComplianceDocument) => {
  const { error } = await supabase.from('documents').delete().eq('id', doc.id);
  if (error) throw error;
  if (doc.docPath) await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.docPath]).catch(() => {});
};

// Short-lived link for viewing a scan; the bucket itself is private.
export const getDocumentUrl = async (docPath: string): Promise<string | null> => {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(docPath, 10 * 60);
  return error ? null : data?.signedUrl ?? null;
};

// ── Fleet health (expiries + maintenance due) ─────────────────────────────
export type AlertKind = 'vehicle_doc' | 'driver_license' | 'document' | 'maintenance';

export interface ComplianceAlert {
  kind: AlertKind;
  entityType: DocEntityType;
  entityId: string;
  label: string;
  item: string;
  dueDate?: string;
  daysLeft: number | null;
  dueOdometer?: number;
  currentOdometer?: number;
}

export const getComplianceAlerts = async (withinDays = 30): Promise<ComplianceAlert[]> => {
  const { data, error } = await supabase.rpc('get_compliance_alerts', { p_within_days: withinDays });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    kind: r.kind,
    entityType: r.entity_type,
    entityId: r.entity_id,
    label: r.label ?? '',
    item: r.item ?? '',
    dueDate: r.due_date ?? undefined,
    daysLeft: r.days_left ?? null,
    dueOdometer: r.due_odometer != null ? Number(r.due_odometer) : undefined,
    currentOdometer: r.current_odometer != null ? Number(r.current_odometer) : undefined,
  }));
};

// ── System health (admin) ─────────────────────────────────────────────────
export interface JobRun {
  jobName: string;
  lastRunAt: string;
  detail: Record<string, unknown>;
}

export const getJobRuns = async (): Promise<JobRun[]> => {
  const { data, error } = await supabase.from('system_job_runs').select('*');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ jobName: r.job_name, lastRunAt: r.last_run_at, detail: r.detail ?? {} }));
};

export const runTripStatsRollup = async (): Promise<number> => {
  const { data, error } = await supabase.rpc('refresh_dirty_trip_stats');
  if (error) throw error;
  return Number(data) || 0;
};

export const runComplianceScan = async (): Promise<number> => {
  const { data, error } = await supabase.rpc('scan_compliance_alerts');
  if (error) throw error;
  return Number(data) || 0;
};
