// ============================================================
// Antemi API Service — Vehicle, Person, InfoAuto & Postal Code lookups
// Base URL: https://antemi-1128ccbacccd.herokuapp.com
// OAuth2 client_credentials with 15-min token caching
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

const ANTEMI_BASE_URL = process.env.ANTEMI_BASE_URL || 'https://antemi-1128ccbacccd.herokuapp.com';
const ANTEMI_CLIENT_ID = process.env.ANTEMI_CLIENT_ID || '';
const ANTEMI_CLIENT_SECRET = process.env.ANTEMI_CLIENT_SECRET || '';

// Per-request timeout (ms) — protects against Antemi/Heroku stalls
const ANTEMI_REQUEST_TIMEOUT_MS = Number(process.env.ANTEMI_REQUEST_TIMEOUT_MS || 15000);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AntemiVehicleData {
  dominio: string;    // plate
  marca: string;      // e.g. "PEUGEOT"
  modelo: string;     // e.g. "308 FELINE HDI"
  anio: string;       // e.g. "2017"
  dni: string;        // owner DNI
}

export interface AntemiInfoAutoResult {
  raw: string;              // e.g. "308 FELINE HDI (32|991|80)"
  marcaCodigo: string;      // e.g. "32"
  modeloCodigo: string;     // e.g. "991"
  subModeloCodigo: string;  // e.g. "80"
}

export interface AntemiPersonData {
  nombre: string;
  apellido: string;
  fullName: string;
  dni: string;
  cuit: string;
  fechaNacimiento: string;
  sexo: string;
  calleNombre: string;
  calleNumero: string;
  callePiso: string;
  calleDepto: string;
  codigoPostal: string;
  subCodigoPostal: string;
  localidad: string;
  provincia: string;
  telefono: string;
  email: string;
}

export interface AntemiPostalCodeResult {
  codigoPostal: string;
  subCodigoPostal: string;
  localidad: string;
  raw: string;
}

export interface AntemiLookupResult {
  found: boolean;
  vehicle: AntemiVehicleData | null;
  person: AntemiPersonData | null;
  infoAuto: AntemiInfoAutoResult | null;
  postalCode: AntemiPostalCodeResult | null;
  source: 'antemi';
}

// ─── OAuth Token Cache ──────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

function invalidateToken(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  // Return cached token if still valid (with 60s safety margin)
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  if (!ANTEMI_CLIENT_ID || !ANTEMI_CLIENT_SECRET) {
    throw new Error('Antemi API credentials not configured (ANTEMI_CLIENT_ID / ANTEMI_CLIENT_SECRET)');
  }

  console.log(`🔐 Antemi: requesting new OAuth token${forceRefresh ? ' (forced refresh)' : ''}...`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANTEMI_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${ANTEMI_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: ANTEMI_CLIENT_ID,
        client_secret: ANTEMI_CLIENT_SECRET,
        grant_type: 'client_credentials',
      }).toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Antemi OAuth failed (${response.status}):`, errorText.substring(0, 300));
      throw new Error(`Antemi OAuth failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { access_token: string; token_type: string; expires_in: number };
    cachedToken = data.access_token;
    // expires_in is in seconds; convert to ms
    tokenExpiresAt = Date.now() + (data.expires_in || 900) * 1000;

    console.log(`✅ Antemi token obtained (expires in ${data.expires_in}s)`);
    return cachedToken;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Authenticated GET helper ───────────────────────────────────────────────
// - applies per-request timeout via AbortController
// - on 401, invalidates cached token and retries once with a fresh token
//   (Antemi docs warn the 15-min token can expire/be revoked mid-session)

async function antemiGet(path: string, _retried = false): Promise<any> {
  const token = await getAccessToken();
  const url = `${ANTEMI_BASE_URL}${path}`;

  console.log(`🔗 Antemi GET: ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANTEMI_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Antemi request timed out after ${ANTEMI_REQUEST_TIMEOUT_MS}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  // Token revoked / expired early → refresh and retry once
  if (response.status === 401 && !_retried) {
    console.warn(`⚠️ Antemi 401 on ${path} — refreshing token and retrying once`);
    invalidateToken();
    await getAccessToken(true);
    return antemiGet(path, true);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Antemi GET ${path} failed (${response.status}):`, errorText.substring(0, 300));
    throw new Error(`Antemi API error ${response.status}: ${errorText.substring(0, 200)}`);
  }

  // Some endpoints return plain text (e.g. InfoAuto, codpost_*); detect by content-type
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await response.json();
    // Treat explicit empty objects/arrays as "no data" per docx guidance
    if (json === null || (Array.isArray(json) && json.length === 0)) return null;
    return json;
  }
  const text = await response.text();
  return text?.trim() ? text : null;
}

// ─── 1. Vehicle Lookup by Plate ─────────────────────────────────────────────

export async function lookupVehicleByPlate(plate: string): Promise<AntemiVehicleData | null> {
  try {
    if (!plate?.trim()) {
      console.warn('⚠️ Antemi vehicle: missing plate');
      return null;
    }
    const data = await antemiGet(`/api/v1/vehiculos/${encodeURIComponent(plate.trim().toUpperCase())}`);
    if (!data || (!data.marca && !data.dominio)) {
      console.log(`⚠️ Antemi: no vehicle found for plate=${plate}`);
      return null;
    }
    console.log(`✅ Antemi vehicle: ${data.marca} ${data.modelo} ${data.anio} (DNI: ${data.dni})`);
    return {
      dominio: data.dominio || plate,
      marca: data.marca || '',
      modelo: data.modelo || '',
      anio: data.anio || '',
      dni: data.dni || '',
    };
  } catch (error: any) {
    console.warn(`⚠️ Antemi vehicle lookup failed: ${error.message}`);
    return null;
  }
}

// ─── 2. InfoAuto Normalization ──────────────────────────────────────────────

export async function lookupInfoAuto(marca: string, modelo: string, anio: string): Promise<AntemiInfoAutoResult | null> {
  try {
    if (!marca?.trim() || !modelo?.trim() || !anio?.trim()) {
      console.warn(`⚠️ Antemi InfoAuto: missing input (marca=${marca}, modelo=${modelo}, anio=${anio})`);
      return null;
    }
    // Per docx: URL-encode each segment (e.g. "308 FELINE HDI" → "308%20FELINE%20HDI")
    const path = `/api/v1/infoauto/${encodeURIComponent(marca.trim())}/${encodeURIComponent(modelo.trim())}/${encodeURIComponent(anio.trim())}`;
    const data = await antemiGet(path);

    // Response is a string like: "308 FELINE HDI (32|991|80)"
    // Or could be JSON array — handle both
    let raw = '';
    if (typeof data === 'string') {
      raw = data.trim();
    } else if (Array.isArray(data) && data.length > 0) {
      // Take first result per documentation
      raw = typeof data[0] === 'string' ? data[0].trim() : JSON.stringify(data[0]);
    } else if (typeof data === 'object' && data !== null) {
      raw = JSON.stringify(data);
    }

    if (!raw) {
      console.log(`⚠️ Antemi: no InfoAuto match for ${marca} ${modelo} ${anio}`);
      return null;
    }

    // Parse codes from pattern: "... (MarcaCodigo|ModeloCodigo|SubModeloCodigo)"
    const codeMatch = raw.match(/\((\d+)\|(\d+)\|(\d+)\)/);
    if (!codeMatch) {
      console.warn(`⚠️ Antemi InfoAuto: could not parse codes from "${raw}"`);
      return null;
    }

    const result: AntemiInfoAutoResult = {
      raw,
      marcaCodigo: codeMatch[1],
      modeloCodigo: codeMatch[2],
      subModeloCodigo: codeMatch[3],
    };
    console.log(`✅ Antemi InfoAuto: marca=${result.marcaCodigo}, modelo=${result.modeloCodigo}, sub=${result.subModeloCodigo}`);
    return result;
  } catch (error: any) {
    console.warn(`⚠️ Antemi InfoAuto lookup failed: ${error.message}`);
    return null;
  }
}

// ─── 3. Person Lookup by DNI ────────────────────────────────────────────────

export async function lookupPersonByDNI(dni: string): Promise<AntemiPersonData | null> {
  try {
    if (!dni?.trim()) {
      console.warn('⚠️ Antemi person: missing DNI');
      return null;
    }
    const data = await antemiGet(`/api/v1/personas/${encodeURIComponent(dni.trim())}`);

    if (!data || typeof data !== 'object') {
      console.log(`⚠️ Antemi: no person found for DNI=${dni}`);
      return null;
    }

    // Map response fields — adjust based on actual API response structure
    const nombre = data.nombre || data.first_name || '';
    const apellido = data.apellido || data.last_name || '';
    const fullName = data.fullName || data.full_name
      || (apellido && nombre ? `${apellido}, ${nombre}` : apellido || nombre || '');

    const person: AntemiPersonData = {
      nombre,
      apellido,
      fullName,
      dni,
      cuit: data.cuit || data.cuil || '',
      fechaNacimiento: data.fechaNacimiento || data.fecha_nacimiento || '',
      sexo: data.sexo || data.sex || '',
      calleNombre: data.calleNombre || data.calle || data.direccion || '',
      calleNumero: data.calleNumero || data.numero || data.altura || '',
      callePiso: data.callePiso || data.piso || '',
      calleDepto: data.calleDepto || data.depto || data.departamento || '',
      codigoPostal: data.codigoPostal || data.codigo_postal || data.cp || '',
      subCodigoPostal: data.subCodigoPostal || data.sub_codigo_postal || '1',
      localidad: data.localidad || data.ciudad || '',
      provincia: data.provincia || '',
      telefono: data.telefono || data.phone || '',
      email: data.email || '',
    };

    console.log(`✅ Antemi person: ${person.fullName} (${person.localidad})`);
    return person;
  } catch (error: any) {
    console.warn(`⚠️ Antemi person lookup failed: ${error.message}`);
    return null;
  }
}

// ─── 4. Postal Code by Address ──────────────────────────────────────────────

export async function lookupPostalCodeByAddress(
  direccion: string,
  localidad: string,
  letra?: string,
): Promise<AntemiPostalCodeResult | null> {
  try {
    const params = new URLSearchParams({ direccion, localidad });
    if (letra) params.set('letra', letra);

    const data = await antemiGet(`/api/v1/codpost_direccion?${params.toString()}`);

    // Response is like: "(1846)(1) ADROGUE"
    const raw = typeof data === 'string' ? data.trim() : JSON.stringify(data);
    if (!raw) return null;

    // Parse: (CP)(SubCP) Localidad
    const cpMatch = raw.match(/\((\d+)\)\((\d+)\)\s*(.*)/);
    if (!cpMatch) {
      console.warn(`⚠️ Antemi postal code: could not parse "${raw}"`);
      // Try alternative format — just digits
      const altMatch = raw.match(/(\d{4})/);
      if (altMatch) {
        return { codigoPostal: altMatch[1], subCodigoPostal: '1', localidad: '', raw };
      }
      return null;
    }

    const result: AntemiPostalCodeResult = {
      codigoPostal: cpMatch[1],
      subCodigoPostal: cpMatch[2],
      localidad: cpMatch[3].trim(),
      raw,
    };
    console.log(`✅ Antemi postal code: ${result.codigoPostal}/${result.subCodigoPostal} ${result.localidad}`);
    return result;
  } catch (error: any) {
    console.warn(`⚠️ Antemi postal code lookup failed: ${error.message}`);
    return null;
  }
}

// ─── 5. Postal Code by Code ────────────────────────────────────────────────

export async function lookupPostalCodeByCode(cp: string): Promise<AntemiPostalCodeResult | null> {
  try {
    const data = await antemiGet(`/api/v1/codpost_codigo/${encodeURIComponent(cp)}`);

    if (!data) return null;

    const raw = typeof data === 'string' ? data.trim() : JSON.stringify(data);

    // Parse first result — same format as address lookup
    const cpMatch = raw.match(/\((\d+)\)\((\d+)\)\s*(.*)/);
    if (cpMatch) {
      return {
        codigoPostal: cpMatch[1],
        subCodigoPostal: cpMatch[2],
        localidad: cpMatch[3].trim(),
        raw,
      };
    }

    // Return raw if we can't parse it
    return { codigoPostal: cp, subCodigoPostal: '1', localidad: '', raw };
  } catch (error: any) {
    console.warn(`⚠️ Antemi postal code by code failed: ${error.message}`);
    return null;
  }
}

// ─── 6. Full Lookup Flow ────────────────────────────────────────────────────
// Orchestrates the complete integration flow:
// 1. Vehicle by plate → get marca/modelo/anio + owner DNI
// 2. Person by DNI
// 3. InfoAuto normalization → GLM codes
// 4. Postal code resolution

export async function fullLookup(plate: string, dni?: string): Promise<AntemiLookupResult> {
  console.log(`🔄 Antemi full lookup: plate=${plate}, dni=${dni || '(from vehicle)'}`);

  // Step 1: Vehicle by plate
  const vehicle = await lookupVehicleByPlate(plate);

  // Use DNI from vehicle response if not provided
  const effectiveDNI = dni || vehicle?.dni || '';

  // Step 2: Person by DNI (parallel-safe since no dependency on infoAuto)
  // Step 3: InfoAuto normalization (depends on vehicle data)
  const [person, infoAuto] = await Promise.all([
    effectiveDNI ? lookupPersonByDNI(effectiveDNI) : Promise.resolve(null),
    vehicle ? lookupInfoAuto(vehicle.marca, vehicle.modelo, vehicle.anio) : Promise.resolve(null),
  ]);

  // Step 4: Postal code from person's address
  let postalCode: AntemiPostalCodeResult | null = null;
  if (person?.calleNombre && person?.localidad) {
    postalCode = await lookupPostalCodeByAddress(
      `${person.calleNombre} ${person.calleNumero}`.trim(),
      person.localidad,
    );
  } else if (person?.codigoPostal) {
    postalCode = await lookupPostalCodeByCode(person.codigoPostal);
  }

  // Merge postal code back into person data if resolved
  if (postalCode && person) {
    person.codigoPostal = postalCode.codigoPostal;
    person.subCodigoPostal = postalCode.subCodigoPostal;
    if (postalCode.localidad && !person.localidad) {
      person.localidad = postalCode.localidad;
    }
  }

  const found = !!(vehicle || person);
  console.log(`${found ? '✅' : '⚠️'} Antemi full lookup complete: vehicle=${!!vehicle}, person=${!!person}, infoAuto=${!!infoAuto}, postalCode=${!!postalCode}`);

  return {
    found,
    vehicle,
    person,
    infoAuto,
    postalCode,
    source: 'antemi',
  };
}
