interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * FARA (Foreign Agents Registration Act) MCP.
 *
 * US DOJ registry of agents who represent FOREIGN principals — foreign
 * governments, political parties, businesses and individuals — in lobbying,
 * PR and political-influence activity inside the United States. This is the
 * foreign-influence counterpart to domestic lobbying disclosure (LDA): if a
 * foreign government hires a US firm to influence policy or public opinion,
 * that relationship is disclosed here.
 *
 * Source: efile.fara.gov bulk eFile API (/api/v1). Keyless.
 *
 * Data-shape notes (important — drives the tool design):
 *  - The active-registrant list is a single bulk dump (~556 rows, ~106KB) with
 *    NO server-side search. `search_registrants` fetches that dump once and
 *    filters CLIENT-SIDE by name substring, then caps results.
 *  - The terminated-registrant dump is much larger (~6,500 rows, ~1.4MB) and is
 *    only fetched when status="terminated" is requested.
 *  - Foreign principals and documents ARE addressable server-side, but only by
 *    registration number (no global foreign-principal dump exists). So you
 *    first find a registrant (search_registrants), then look up who they work
 *    for (list_foreign_principals) and what they filed (get_registrant_documents).
 *  - Upstream rate limit: 5 requests / 10s (429 on exceed). Each tool here is a
 *    single upstream call.
 */


const BASE = 'https://efile.fara.gov/api/v1';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const MAX_RESULTS = 100;

const tools: McpToolExport['tools'] = [
  {
    name: 'search_registrants',
    description:
      'Search FARA registrants — US agents registered to represent FOREIGN principals (foreign governments, parties, businesses) for lobbying/influence inside the US. FARA has no server-side search, so this fetches the bulk active-registrant dump (~556 rows) once and filters CLIENT-SIDE by a name substring (case-insensitive); results are capped. Set status="terminated" to search the much larger terminated dump (~6,500 rows, ~1.4MB fetched once). Returns each registrant\'s name, registration_number (use it with list_foreign_principals / get_registrant_documents), address and registration_date. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Case-insensitive substring matched against the registrant name + business name, e.g. "scoyoc", "global", "BGR". Omit to return the first page of all registrants.',
        },
        status: {
          type: 'string',
          enum: ['active', 'terminated'],
          description: 'Which registrant dump to search. Default "active".',
        },
        limit: {
          type: 'number',
          description: `Max rows to return (default 25, hard cap ${MAX_RESULTS}).`,
        },
      },
    },
  },
  {
    name: 'list_foreign_principals',
    description:
      'List the FOREIGN principals (foreign governments, parties, companies, individuals) that a given FARA registrant represents — i.e. who a US agent is working for. Addressed server-side by registration_number (get one from search_registrants). Optionally filter the returned set CLIENT-SIDE by country or principal-name substring. Set status="terminated" for former relationships. Returns principal_name, country, registrant_name, registration_date and address. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        registration_number: {
          type: 'number',
          description: 'FARA registration number of the US agent/firm (from search_registrants).',
        },
        country: {
          type: 'string',
          description: 'Optional case-insensitive substring filter on the principal\'s country, e.g. "italy", "saudi".',
        },
        name: {
          type: 'string',
          description: 'Optional case-insensitive substring filter on the foreign-principal name.',
        },
        status: {
          type: 'string',
          enum: ['active', 'terminated'],
          description: 'Active or terminated representation. Default "active".',
        },
      },
      required: ['registration_number'],
    },
  },
  {
    name: 'get_registrant_documents',
    description:
      'List FARA filings (PDF documents) for a registrant by registration_number (from search_registrants) — registration statements, supplemental statements, informational materials, exhibits, etc. Each row links the document to the specific foreign principal/country it concerns and gives a direct PDF URL. Optionally filter CLIENT-SIDE by document_type or country substring. Results are capped. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        registration_number: {
          type: 'number',
          description: 'FARA registration number of the registrant (from search_registrants).',
        },
        document_type: {
          type: 'string',
          description: 'Optional case-insensitive substring filter on document type, e.g. "supplemental", "exhibit", "informational".',
        },
        country: {
          type: 'string',
          description: 'Optional case-insensitive substring filter on the associated foreign-principal country.',
        },
        limit: {
          type: 'number',
          description: `Max documents to return (default 50, hard cap ${MAX_RESULTS}).`,
        },
      },
      required: ['registration_number'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'search_registrants':
        return searchRegistrants(args);
      case 'list_foreign_principals':
        return listForeignPrincipals(args);
      case 'get_registrant_documents':
        return getRegistrantDocuments(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// --- helpers ---------------------------------------------------------------

async function faraGet(path: string): Promise<{ ok: true; data: unknown } | { ok: false; error: unknown }> {
  const res = await fetch(`${BASE}/${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  // FARA returns 404 with a JSON {Success:false,...} body when a registration
  // number simply has no rows of the requested kind; treat that as "empty".
  if (res.status === 404) return { ok: false, error: { not_found: true } };
  if (res.status === 429) return { ok: false, error: { error: 'FARA rate limit (5 req / 10s) — retry shortly' } };
  const text = await res.text();
  if (!res.ok) return { ok: false, error: { error: `FARA: ${res.status} ${text.slice(0, 200)}` } };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    // FARA emits invalid JSON ({ Success: false, ... }) for some error states.
    return { ok: false, error: { not_found: true } };
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function includesCI(haystack: unknown, needle: string): boolean {
  return str(haystack).toLowerCase().includes(needle.toLowerCase());
}

// ROWSET.ROW (foreign principals / docs) is an OBJECT for one row, an ARRAY for
// many, and absent for none. Normalize to a plain array.
function rowsetRows(data: unknown): Array<Record<string, unknown>> {
  const rowset = (data as Record<string, unknown> | undefined)?.ROWSET as Record<string, unknown> | undefined;
  const row = rowset?.ROW;
  if (Array.isArray(row)) return row as Array<Record<string, unknown>>;
  if (row && typeof row === 'object') return [row as Record<string, unknown>];
  return [];
}

function addressOf(r: Record<string, unknown>, k1 = 'Address_1', k2 = 'Address_2', city = 'City', state = 'State', zip = 'Zip'): string {
  return [r[k1], r[k2], r[city], r[state], r[zip]].map(str).filter(Boolean).join(', ');
}

function capLimit(v: unknown, def: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(1, Math.min(MAX_RESULTS, n));
}

// --- tools -----------------------------------------------------------------

async function searchRegistrants(args: Record<string, unknown>): Promise<unknown> {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const status = args.status === 'terminated' ? 'terminated' : 'active';
  const limit = capLimit(args.limit, 25);

  const path = status === 'terminated' ? 'Registrants/json/Terminated' : 'Registrants/json/Active';
  const r = await faraGet(path);
  if (!r.ok) return r.error;

  const top = (r.data as Record<string, unknown>) ?? {};
  const containerKey = status === 'terminated' ? 'REGISTRANTS_TERMINATED' : 'REGISTRANTS_ACTIVE';
  const container = top[containerKey] as Record<string, unknown> | undefined;
  let rows = container?.ROW;
  if (rows && !Array.isArray(rows)) rows = [rows];
  const all = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];

  const filtered = name
    ? all.filter((r2) => includesCI(r2.Name, name) || includesCI(r2.Business_Name, name))
    : all;

  return {
    status,
    note: 'FARA covers US agents representing FOREIGN principals. No server-side search; filtered client-side from the bulk dump.',
    total_in_dump: all.length,
    match_count: filtered.length,
    returned: Math.min(filtered.length, limit),
    truncated: filtered.length > limit,
    registrants: filtered.slice(0, limit).map((r2) => ({
      registrant_name: str(r2.Name),
      business_name: str(r2.Business_Name) || undefined,
      registration_number: r2.Registration_Number,
      registration_date: str(r2.Registration_Date),
      address: addressOf(r2),
    })),
  };
}

async function listForeignPrincipals(args: Record<string, unknown>): Promise<unknown> {
  const regNum = typeof args.registration_number === 'number' ? args.registration_number : Number(args.registration_number);
  if (!Number.isFinite(regNum)) return { error: 'provide a numeric registration_number (from search_registrants)' };
  const status = args.status === 'terminated' ? 'Terminated' : 'Active';
  const country = typeof args.country === 'string' ? args.country.trim() : '';
  const nameFilter = typeof args.name === 'string' ? args.name.trim() : '';

  const r = await faraGet(`ForeignPrincipals/json/${status}/${regNum}`);
  if (!r.ok) {
    const err = r.error as Record<string, unknown>;
    if (err.not_found) {
      return {
        registration_number: regNum,
        status: status.toLowerCase(),
        count: 0,
        foreign_principals: [],
        note: `No ${status.toLowerCase()} foreign principals on file for registration ${regNum}.`,
      };
    }
    return r.error;
  }

  let rows = rowsetRows(r.data);
  if (country) rows = rows.filter((p) => includesCI(p.COUNTRY_NAME, country));
  if (nameFilter) rows = rows.filter((p) => includesCI(p.FP_NAME, nameFilter));

  return {
    registration_number: regNum,
    status: status.toLowerCase(),
    count: rows.length,
    note: 'Foreign principals are the foreign governments/orgs/persons this registrant represents in the US.',
    foreign_principals: rows.map((p) => ({
      principal_name: str(p.FP_NAME),
      country: str(p.COUNTRY_NAME),
      registrant_name: str(p.REGISTRANT_NAME),
      registration_date: str(p.FP_REG_DATE) || str(p.REG_DATE),
      address: addressOf(p, 'ADDRESS_1', 'ADDRESS_2', 'CITY', 'STATE', 'ZIP'),
    })),
  };
}

async function getRegistrantDocuments(args: Record<string, unknown>): Promise<unknown> {
  const regNum = typeof args.registration_number === 'number' ? args.registration_number : Number(args.registration_number);
  if (!Number.isFinite(regNum)) return { error: 'provide a numeric registration_number (from search_registrants)' };
  const docType = typeof args.document_type === 'string' ? args.document_type.trim() : '';
  const country = typeof args.country === 'string' ? args.country.trim() : '';
  const limit = capLimit(args.limit, 50);

  const r = await faraGet(`RegDocs/json/${regNum}`);
  if (!r.ok) {
    const err = r.error as Record<string, unknown>;
    if (err.not_found) {
      return { registration_number: regNum, count: 0, documents: [], note: `No documents on file for registration ${regNum}.` };
    }
    return r.error;
  }

  let rows = rowsetRows(r.data);
  if (docType) rows = rows.filter((d) => includesCI(d.DOCUMENT_TYPE, docType));
  if (country) rows = rows.filter((d) => includesCI(d.FOREIGN_PRINCIPAL_COUNTRY, country));

  return {
    registration_number: regNum,
    match_count: rows.length,
    returned: Math.min(rows.length, limit),
    truncated: rows.length > limit,
    documents: rows.slice(0, limit).map((d) => ({
      date: str(d.DATE_STAMPED),
      document_type: str(d.DOCUMENT_TYPE),
      registrant_name: str(d.REGISTRANT_NAME),
      foreign_principal_name: str(d.FOREIGN_PRINCIPAL_NAME) || undefined,
      foreign_principal_country: str(d.FOREIGN_PRINCIPAL_COUNTRY) || undefined,
      short_form_name: str(d.SHORT_FORM_NAME) || undefined,
      url: str(d.URL),
    })),
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
