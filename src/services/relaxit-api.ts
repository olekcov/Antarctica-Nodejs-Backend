/**
 * RelaxIT API Service — Vehicle + Person lookup by Plate + DNI
 * 
 * This service calls Pablo's external API to retrieve vehicle and person data.
 * Currently using a PLACEHOLDER that returns mock data.
 * 
 * TODO: Replace with actual RelaxIT API endpoint when Pablo delivers it.
 * Expected: POST/GET to RelaxIT endpoint with plate + DNI → returns vehicle codes + person info
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RelaxITVehicleData {
  // Human-readable
  marca: string;           // e.g. "CITROEN"
  modelo: string;          // e.g. "C 3 1.5I ORIGINE PACK ZENITH"
  anioFabricacion: string; // e.g. "2017"
  // Internal codes for Antártida API (invisible to user)
  marcaCodigo: string;     // e.g. "11"
  modeloCodigo: string;    // e.g. "251"
  subModeloCodigo: string; // e.g. "1"
}

export interface RelaxITPersonData {
  fullName: string;        // e.g. "CASTRO, ROBERTO ANTONIO"
  cuit: string;            // e.g. "20061889400"
  dni: string;
  fechaNacimiento: string; // YYYY/MM/DD
  sexo: string;            // "1" = M, "2" = F
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

export interface RelaxITLookupResult {
  found: boolean;
  vehicle: RelaxITVehicleData | null;
  person: RelaxITPersonData | null;
  source: 'relaxit' | 'placeholder';
}

// ─── Configuration ───────────────────────────────────────────────────────────

// TODO: Set these when Pablo delivers the actual API
const RELAXIT_API_URL = process.env.RELAXIT_API_URL || '';
const RELAXIT_API_KEY = process.env.RELAXIT_API_KEY || '';

// ─── Lookup Function ─────────────────────────────────────────────────────────

export async function lookupByPlateAndDNI(plate: string, dni: string): Promise<RelaxITLookupResult> {
  // If RelaxIT API is configured, call it
  if (RELAXIT_API_URL) {
    try {
      return await callRelaxITAPI(plate, dni);
    } catch (error: any) {
      console.warn(`⚠️ RelaxIT API failed, using placeholder: ${error.message}`);
    }
  }

  // PLACEHOLDER: Return empty data for manual entry
  // When Pablo's API is ready, this fallback will only be used on API failure
  console.log(`📋 RelaxIT API not configured — returning empty data for plate=${plate}, dni=${dni}`);
  return {
    found: false,
    vehicle: null,
    person: null,
    source: 'placeholder',
  };
}

// ─── Actual RelaxIT API Call ─────────────────────────────────────────────────

async function callRelaxITAPI(plate: string, dni: string): Promise<RelaxITLookupResult> {
  console.log(`🔗 RelaxIT API call: plate=${plate}, dni=${dni} → ${RELAXIT_API_URL}`);

  // TODO: Adjust request format based on Pablo's actual API spec
  const response = await fetch(RELAXIT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(RELAXIT_API_KEY ? { 'Authorization': `Bearer ${RELAXIT_API_KEY}` } : {}),
    },
    body: JSON.stringify({ patente: plate, dni }),
  });

  if (!response.ok) {
    throw new Error(`RelaxIT API error: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();
  console.log(`✅ RelaxIT API returned data for plate=${plate}`);

  // TODO: Map Pablo's actual response fields to our interface
  // The mapping below is a guess — adjust when we see the real response format
  return {
    found: true,
    vehicle: {
      marca: data.marca || data.vehiculo?.marca || '',
      modelo: data.modelo || data.vehiculo?.modelo || '',
      anioFabricacion: String(data.anioFabricacion || data.vehiculo?.anio || ''),
      marcaCodigo: String(data.marcaCodigo || data.vehiculo?.marcaCodigo || ''),
      modeloCodigo: String(data.modeloCodigo || data.vehiculo?.modeloCodigo || ''),
      subModeloCodigo: String(data.subModeloCodigo || data.vehiculo?.subModeloCodigo || '1'),
    },
    person: {
      fullName: data.nombre || data.persona?.nombre || '',
      cuit: data.cuit || data.persona?.cuit || '',
      dni: dni,
      fechaNacimiento: data.fechaNacimiento || data.persona?.fechaNacimiento || '',
      sexo: data.sexo || data.persona?.sexo || '',
      calleNombre: data.calleNombre || data.persona?.calle || '',
      calleNumero: data.calleNumero || data.persona?.numero || '',
      callePiso: data.callePiso || data.persona?.piso || '',
      calleDepto: data.calleDepto || data.persona?.depto || '',
      codigoPostal: data.codigoPostal || data.persona?.codigoPostal || '',
      subCodigoPostal: data.subCodigoPostal || data.persona?.subCodigoPostal || '1',
      localidad: data.localidad || data.persona?.localidad || '',
      provincia: data.provincia || data.persona?.provincia || '',
      telefono: data.telefono || data.persona?.telefono || '',
      email: data.email || data.persona?.email || '',
    },
    source: 'relaxit',
  };
}

// ─── Motor / Chasis Generator ────────────────────────────────────────────────

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomAlphanumeric(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ALPHANUMERIC[Math.floor(Math.random() * ALPHANUMERIC.length)];
  }
  return result;
}

/** Generate random Motor number (14 alphanumeric characters) */
export function generateMotor(): string {
  return randomAlphanumeric(14);
}

/** Generate random Chasis number (17 alphanumeric characters) */
export function generateChasis(): string {
  return randomAlphanumeric(17);
}
