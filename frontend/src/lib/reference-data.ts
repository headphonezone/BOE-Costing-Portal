/**
 * Master data lifted from the F-SHEET tab of the costing template embedded in
 * BOE-Costing-Sheet/boe_parser.py. It was maintained by hand in the
 * spreadsheet; kept here so the portal's dropdowns match what the team
 * already uses. Not currently persisted -- move to a table if it starts
 * changing often.
 */

export const PAYMENT_TERMS = ["ADVANCE", "CREDIT"] as const;

export const LOCATIONS = ["BANGALORE", "CHENNAI", "OTHER"] as const;

export const CURRENCIES = ["USD", "POUNDS", "HKD", "EURO", "SGD", "GBP"] as const;

export const DELIVERY_TERMS = ["FOB", "C&F", "EXW", "CIF", "DDU"] as const;

/** Customs house agents -- the "CLEARED" column. */
export const CLEARING_AGENTS = [
  "Fedex",
  "GLOBAL LOGISTICS",
  "KING SHIPPING",
  "B & H logistics",
  "DHL",
  "CATHAY",
  "DENKEN GLOBAL SUPPLY CHAIN",
] as const;

export const FREIGHT_FORWARDERS = [
  "HELLMAN",
  "FEDEX",
  "DHL",
  "ARAMEX",
  "KERRY LOGISTICS",
  "VIRYA LOGISTICS",
  "FREIGT SYSTEMS",
] as const;

/**
 * What actually gets paid in cash at clearance. When an item's BCD is covered
 * by a licence only SWS and IGST are paid; otherwise all three are.
 */
export const DUTY_PAYMENT_BASIS = ["SWS+IGST", "BCD+SWS+IGST"] as const;

/** Supplier master, with each supplier's standing payment terms. */
export const SUPPLIERS: ReadonlyArray<{ name: string; terms: "ADVANCE" | "CREDIT" }> = [
  { name: "ABBINGDON LIMITED (IFI)", terms: "ADVANCE" },
  { name: "AUDEZE LLC", terms: "CREDIT" },
  { name: "AUDIO LINEOUT (CAMPFIRE)", terms: "CREDIT" },
  { name: "BEIJING INFOMEDIA", terms: "ADVANCE" },
  { name: "BURSON AUDIO", terms: "ADVANCE" },
  { name: "CHORD ELECTRONICS", terms: "ADVANCE" },
  { name: "CMA AUDIO", terms: "ADVANCE" },
  { name: "DAN CLARK", terms: "CREDIT" },
  { name: "DEKONI AUDIO", terms: "ADVANCE" },
  { name: "DONGGUAN YUANZE (KZ)", terms: "ADVANCE" },
  { name: "DREAMUS (A&K)", terms: "ADVANCE" },
  { name: "EARMEN", terms: "ADVANCE" },
  { name: "EDIFIER INTERNATIONAL (STAX)", terms: "ADVANCE" },
  { name: "HIBY (ETERNAL ASIA)", terms: "ADVANCE" },
  { name: "HIBY", terms: "ADVANCE" },
  { name: "ETYMOTIC", terms: "ADVANCE" },
  { name: "FANMUSIC", terms: "ADVANCE" },
  { name: "FIIO TECHNOLOGY", terms: "ADVANCE" },
  { name: "FINAL INC", terms: "CREDIT" },
  { name: "FOCAL INC", terms: "ADVANCE" },
  { name: "HEARING COMPONENT", terms: "CREDIT" },
  { name: "HEDD AUDIO", terms: "ADVANCE" },
  { name: "HIDIZS TECHNOLOGY", terms: "ADVANCE" },
  { name: "IBASSO AUDIO LIMITED", terms: "ADVANCE" },
  { name: "IKKO TECHNOLOGY", terms: "ADVANCE" },
  { name: "JABEN", terms: "ADVANCE" },
  { name: "KINERA", terms: "ADVANCE" },
  { name: "LI ZHUOSHENG", terms: "ADVANCE" },
  { name: "LINSOUL", terms: "ADVANCE" },
  { name: "MATRIX", terms: "ADVANCE" },
  { name: "MEZE AUDIO LIMITED", terms: "CREDIT" },
  { name: "MEZE AUDIO SRL", terms: "CREDIT" },
  { name: "MI SERVICES (V-MODA)", terms: "ADVANCE" },
  { name: "NOBLE AUDIO", terms: "ADVANCE" },
  { name: "ODEON INC (SCHIIT)", terms: "ADVANCE" },
  { name: "QU JING (VENTURE ELECTRONICS)", terms: "ADVANCE" },
  { name: "REXTEC INTERNATIONAL (SPINFIT)", terms: "ADVANCE" },
  { name: "SHANLING TECHNOLOGY LIMITED", terms: "ADVANCE" },
  { name: "SOUND INNOVATION", terms: "CREDIT" },
  { name: "STYMAX INTERNATIONAL", terms: "ADVANCE" },
  { name: "V2.0 (GRADO)", terms: "ADVANCE" },
  { name: "VINSHINE (DENAFRIPS)", terms: "ADVANCE" },
  { name: "VISION EARS", terms: "ADVANCE" },
  { name: "WANG JIYONG", terms: "ADVANCE" },
  { name: "WUHAN AUNE ACOUSTICS", terms: "ADVANCE" },
  { name: "ZENG JINDING (TOPPING)", terms: "ADVANCE" },
  { name: "ZHUHAI SHENG LANG (UNIQUE MELODY)", terms: "ADVANCE" },
  { name: "ZHUHAI SPARK LIMITED (KEGCHANYAE APLK CO LTD)", terms: "ADVANCE" },
  { name: "ZHUHAI SPARK", terms: "ADVANCE" },
];
