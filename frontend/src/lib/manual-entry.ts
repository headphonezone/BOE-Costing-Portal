/**
 * Creating a BOE record by hand, for when there is no ICEGATE PDF or the
 * parser cannot read the one there is.
 *
 * This writes to Supabase directly rather than going through the FastAPI
 * service, and that is deliberate: manual entry exists as the fallback for
 * when parsing fails, so it must not depend on the parser being reachable.
 *
 * The write mirrors the backend's `save_boe()` exactly -- upsert the header,
 * then replace the item rows wholesale -- so a record entered by hand is
 * indistinguishable from a parsed one, and re-saving never leaves stale rows
 * behind.
 */
import { supabase } from "./supabase";

export type ManualItemDraft = {
  description: string;
  qty: string;
  unit_price_usd: string;
  assess_value: string;
  bcd: string;
  sws: string;
  igst: string;
};

export type ManualBoeDraft = {
  be_no: string;
  be_date: string;
  supplier_name: string;
  importer_name: string;
  inv_no: string;
  inv_date: string;
  inv_value_usd: string;
  exchange_rate: string;
  freight_inr: string;
  insurance_inr: string;
  misc_charges_inr: string;
  hawb_no: string;
  items: ManualItemDraft[];
};

export function emptyItem(): ManualItemDraft {
  return {
    description: "",
    qty: "",
    unit_price_usd: "",
    assess_value: "",
    bcd: "",
    sws: "",
    igst: "",
  };
}

export function emptyDraft(): ManualBoeDraft {
  return {
    be_no: "",
    be_date: "",
    supplier_name: "",
    importer_name: "",
    inv_no: "",
    inv_date: "",
    inv_value_usd: "",
    exchange_rate: "",
    freight_inr: "",
    insurance_inr: "",
    misc_charges_inr: "",
    hawb_no: "",
    items: [emptyItem()],
  };
}

/** Blank means "not known", which is null in the database -- never zero. */
function num(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function text(raw: string): string | null {
  const t = raw.trim();
  return t === "" ? null : t;
}

/** An item row the user started but left blank is ignored rather than saved. */
export function isBlankItem(item: ManualItemDraft): boolean {
  return Object.values(item).every((v) => v.trim() === "");
}

export function validate(draft: ManualBoeDraft): string[] {
  const errors: string[] = [];

  if (!draft.be_no.trim()) {
    errors.push("BE number is required — it is the key every record is stored under.");
  }

  const rate = num(draft.exchange_rate);
  if (rate === null || rate <= 0) {
    errors.push("Exchange rate is required, and must be greater than zero.");
  }

  const filled = draft.items.filter((i) => !isBlankItem(i));
  if (filled.length === 0) {
    errors.push("Add at least one item.");
  }

  filled.forEach((item, i) => {
    const n = i + 1;
    if (!item.description.trim()) errors.push(`Item ${n}: description is required.`);
    const qty = num(item.qty);
    if (qty === null || qty <= 0) errors.push(`Item ${n}: quantity must be greater than zero.`);
    if (num(item.unit_price_usd) === null) errors.push(`Item ${n}: rate is required.`);
  });

  return errors;
}

/** True if a record already exists under this BE number. */
export async function boeExists(be_no: string): Promise<boolean> {
  const key = be_no.trim();
  if (!key) return false;
  const { data, error } = await supabase
    .from("boes")
    .select("be_no")
    .eq("be_no", key)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function createBoeManually(draft: ManualBoeDraft): Promise<string> {
  const errors = validate(draft);
  if (errors.length > 0) throw new Error(errors[0]);

  const be_no = draft.be_no.trim();
  const items = draft.items.filter((i) => !isBlankItem(i));

  const rows = items.map((item, index) => {
    const bcd = num(item.bcd) ?? 0;
    const sws = num(item.sws) ?? 0;
    const igst = num(item.igst) ?? 0;
    return {
      be_no,
      // A hand-entered BOE is treated as a single invoice, so the global
      // sequence number and the per-invoice item number are the same.
      global_sno: index + 1,
      invsno: 1,
      itemsn: index + 1,
      description: text(item.description),
      unit_price_usd: num(item.unit_price_usd),
      qty: num(item.qty),
      assess_value: num(item.assess_value),
      bcd,
      bcd_forgone: null,
      sws,
      igst,
      total_duty: round2(bcd + sws + igst),
    };
  });

  const totalDuty = rows.reduce((s, r) => s + (r.total_duty ?? 0), 0);
  const assessValues = rows
    .map((r) => r.assess_value)
    .filter((v): v is number => v !== null);

  const header = {
    be_no,
    be_date: text(draft.be_date),
    importer_name: text(draft.importer_name),
    supplier_name: text(draft.supplier_name),
    inv_no: text(draft.inv_no),
    inv_date: text(draft.inv_date),
    inv_value_usd: num(draft.inv_value_usd),
    freight_inr: num(draft.freight_inr),
    insurance_inr: num(draft.insurance_inr),
    misc_charges_inr: num(draft.misc_charges_inr),
    exchange_rate: num(draft.exchange_rate),
    hawb_no: text(draft.hawb_no),
    total_assess_value: assessValues.length > 0 ? round2(sum(assessValues)) : null,
    total_duty: totalDuty > 0 ? round2(totalDuty) : null,
    updated_at: new Date().toISOString(),
  };

  const { error: headerError } = await supabase
    .from("boes")
    .upsert(header, { onConflict: "be_no" });
  if (headerError) throw headerError;

  const { error: clearError } = await supabase
    .from("boe_items")
    .delete()
    .eq("be_no", be_no);
  if (clearError) throw clearError;

  const { error: itemsError } = await supabase.from("boe_items").insert(rows);
  if (itemsError) throw itemsError;

  return be_no;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
