import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";

const GROUP_ID = "7045507";
const BASE_EID = 566009225;
const DEFAULT_START_SALE = 1;
const DEFAULT_COUNT = 665;
const REFERER =
  "https://www.zeemaps.com/pub?group=7045507&search=1&nopdf=1&list=1&x=-122.378555&y=47.550730&z=4";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type Address = {
  country?: string;
  city?: string;
  street?: string;
  street2?: string;
  state?: string;
  postcode?: string;
};

type EtextResponse = {
  title?: string;
  ad?: Address;
  fields?: Record<string, string>;
  lat?: number;
  lng?: number;
};

type Row = {
  sale_number: string;
  eid: string;
  title: string;
  street: string;
  street2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  description: string;
  lat: string;
  lng: string;
};

type ParsedArgs = {
  outPath: string;
  concurrency: number;
  startSale: number;
  /** How many sale rows to fetch (after applying --limit cap vs --count). */
  span: number;
  allowPartial: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  let outPath = "./out/listings.csv";
  let limitCap: number | undefined;
  let startSale = DEFAULT_START_SALE;
  let count = DEFAULT_COUNT;
  let allowPartial = false;
  let concurrencyFlag: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" && argv[i + 1]) {
      outPath = argv[++i];
    } else if (a === "--limit" && argv[i + 1]) {
      limitCap = Number(argv[++i]);
    } else if (a === "--start" && argv[i + 1]) {
      startSale = Number(argv[++i]);
    } else if (a === "--count" && argv[i + 1]) {
      count = Number(argv[++i]);
    } else if (a === "--concurrency" && argv[i + 1]) {
      concurrencyFlag = Number(argv[++i]);
    } else if (a === "--allow-partial") {
      allowPartial = true;
    }
  }

  const fromEnv = Number(process.env.CONCURRENCY ?? "");
  let concurrency = 20;
  if (concurrencyFlag !== undefined && Number.isFinite(concurrencyFlag) && concurrencyFlag >= 1) {
    concurrency = Math.floor(concurrencyFlag);
  } else if (Number.isFinite(fromEnv) && fromEnv >= 1) {
    concurrency = Math.floor(fromEnv);
  }

  if (!Number.isFinite(startSale) || startSale < 1) startSale = DEFAULT_START_SALE;
  if (!Number.isFinite(count) || count < 1) count = DEFAULT_COUNT;
  startSale = Math.floor(startSale);
  count = Math.floor(count);

  const span =
    limitCap !== undefined && Number.isFinite(limitCap) && limitCap >= 1
      ? Math.min(Math.floor(limitCap), count)
      : count;

  return {
    outPath: path.resolve(process.cwd(), outPath),
    concurrency,
    startSale,
    span,
    allowPartial,
  };
}

function eidForSale(saleNumber: number): number {
  return BASE_EID + saleNumber - 1;
}

function buildUrl(eid: number): string {
  const dc = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const params = new URLSearchParams({
    g: GROUP_ID,
    j: "1",
    sh: "",
    _dc: dc,
    eids: `[${eid}]`,
    emb: "1",
  });
  return `https://www.zeemaps.com/etext?${params.toString()}&g=${GROUP_ID}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableHttp(status: number): boolean {
  return status === 429 || status >= 500;
}

function isLikelyNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code)
      : "";
  return ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"].includes(
    code,
  );
}

async function fetchEtext(eid: number): Promise<EtextResponse> {
  const url = buildUrl(eid);
  const maxAttempts = 3;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
          Referer: REFERER,
          "User-Agent": USER_AGENT,
        },
      });

      if (isRetryableHttp(res.status)) {
        lastErr = new Error(`HTTP ${res.status}`);
        const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (e) {
        throw e instanceof Error ? e : new SyntaxError("Invalid JSON");
      }
      const data = parsed as EtextResponse | EtextResponse[];
      const marker = Array.isArray(data) ? data[0] : data;
      if (!marker || typeof marker !== "object") {
        throw new Error("Unexpected JSON shape");
      }
      return marker;
    } catch (e) {
      lastErr = e;
      if (e instanceof SyntaxError) throw e;
      if (e instanceof Error && /^HTTP [0-9]+$/.test(e.message)) {
        const code = Number(e.message.slice(5));
        if (!isRetryableHttp(code)) throw e;
      }
      if (
        !isLikelyNetworkError(e) &&
        !(e instanceof Error && e.message.startsWith("HTTP "))
      ) {
        throw e;
      }
      const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await sleep(backoff);
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Failed after ${maxAttempts} attempts for eid ${eid}`);
}

function fieldsToDescription(fields: Record<string, string> | undefined): string {
  if (!fields || Object.keys(fields).length === 0) return "";
  const keys = Object.keys(fields).sort(
    (a, b) => Number(a) - Number(b) || a.localeCompare(b, undefined, { numeric: true }),
  );
  return keys.map((k) => fields[k] ?? "").join(" ");
}

function mapRow(saleNumber: number, eid: number, data: EtextResponse): Row {
  const ad = data.ad ?? {};
  return {
    sale_number: String(saleNumber),
    eid: String(eid),
    title: data.title ?? "",
    street: ad.street ?? "",
    street2: ad.street2 ?? "",
    city: ad.city ?? "",
    state: ad.state ?? "",
    postcode: ad.postcode ?? "",
    country: ad.country ?? "",
    description: fieldsToDescription(data.fields),
    lat: data.lat !== undefined && data.lat !== null ? String(data.lat) : "",
    lng: data.lng !== undefined && data.lng !== null ? String(data.lng) : "",
  };
}

function emptyRow(saleNumber: number, eid: number): Row {
  return {
    sale_number: String(saleNumber),
    eid: String(eid),
    title: "",
    street: "",
    street2: "",
    city: "",
    state: "",
    postcode: "",
    country: "",
    description: "",
    lat: "",
    lng: "",
  };
}

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToLine(row: Row): string {
  const cols = [
    row.sale_number,
    row.eid,
    row.title,
    row.street,
    row.street2,
    row.city,
    row.state,
    row.postcode,
    row.country,
    row.description,
    row.lat,
    row.lng,
  ];
  return cols.map(escapeCsvField).join(",");
}

const HEADER =
  "sale_number,eid,title,street,street2,city,state,postcode,country,description,lat,lng";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const limit = pLimit(args.concurrency);

  const jobs: Promise<{
    saleNumber: number;
    eid: number;
    row: Row;
    ok: boolean;
  }>[] = [];

  for (let i = 0; i < args.span; i++) {
    const saleNumber = args.startSale + i;
    const eid = eidForSale(saleNumber);

    jobs.push(
      limit(async () => {
        try {
          const data = await fetchEtext(eid);
          return { saleNumber, eid, row: mapRow(saleNumber, eid, data), ok: true };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`ERROR sale ${saleNumber} eid ${eid}: ${msg}`);
          return { saleNumber, eid, row: emptyRow(saleNumber, eid), ok: false };
        }
      }),
    );
  }

  const results = await Promise.all(jobs);
  results.sort((a, b) => a.saleNumber - b.saleNumber);

  let failures = 0;
  const rows: Row[] = [];
  for (const r of results) {
    if (!r.ok) failures++;
    rows.push(r.row);
  }

  const outDir = path.dirname(args.outPath);
  await mkdir(outDir, { recursive: true });

  const lines = [HEADER, ...rows.map(rowToLine)];
  await writeFile(args.outPath, lines.join("\n") + "\n", "utf8");

  console.error(
    `Wrote ${rows.length} rows to ${args.outPath} (${failures} failures, concurrency ${args.concurrency})`,
  );

  if (failures > 0 && !args.allowPartial) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
