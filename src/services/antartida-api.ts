// ============================================================
// Antártida SOAP API Integration Service
// WSCotizarAutomotores & WSEmitirCotizacionAutomotores
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

const ANTARTIDA_WSDL_URL = process.env.ANTARTIDA_WSDL_URL ||
  'https://gestion-test.antartidaseguros.com.ar//ANTARTIDA_COMERCIAL_PRUE/servlet/ar.com.glmsa.seguros.comercial.awscotizarautomotores';

const ANTARTIDA_EMISION_URL = process.env.ANTARTIDA_EMISION_URL ||
  'https://gestion-test.antartidaseguros.com.ar//ANTARTIDA_COMERCIAL_PRUE/servlet/ar.com.glmsa.seguros.comercial.awsemitircotizacionautomotores';

const ANTARTIDA_SISTEMA_ORIGEN = process.env.ANTARTIDA_SISTEMA_ORIGEN || 'PRUEBA';
const ANTARTIDA_PRODUCTOR_CODIGO = process.env.ANTARTIDA_PRODUCTOR_CODIGO || '5539';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CotizacionRequest {
  rama: string;              // 4 = autos, 28 = motovehiculos
  tipoPolizaCodigo: string;  // AUT01 for rama 4, MOT01 for rama 28
  tomadorNombre: string;
  tomadorCUIT: string;
  tomadorTipoPersona: string;
  tomadorCategoriaIVA: string;
  vigenciaDesde: string;     // YYYY/MM/DD
  productorCodigo?: string;
  planComercialCodigo: string;
  formaPagoCodigo: string;
  modoFacturacionCodigo: string;
  condicionPagoCodigo: string;
  codigoPostal: string;
  subCodigoPostal: string;
  marcaCodigo: string;
  modeloCodigo: string;
  subModeloCodigo: string;
  ceroKM?: string;
  anioFabricacion: string;
  sumaAsegurada?: string;
  multiproductoCotizar?: string;
  coberturasCotizar?: Array<{ cobertura: string; premioInformado: string }>;
}

export interface CotizacionResponse {
  rama: string;
  solicitud: string;
  instalacion: string;
  descripcionVehiculo: string;
  coberturas: Array<{
    item: string;
    cobertura: string;
    coberturaDsc: string;
    sumaAsegurada: string;
    prima: string;
    porcBonificacion: string;
    bonificacion: string;
    porcRecargoAdministrativo: string;
    recargoAdministrativo: string;
    recargoFinanciero: string;
    derechoEmision: string;
    impuestos: string;
    premio: string;
    importeCuota1: string;
    importeRestoCuotas: string;
    comision: string;
  }>;
}

export interface EmisionRequest {
  rama: string;
  solicitud: string;
  instalacion: string;
  itemSeleccionado: string;
  cobertura?: string;
  tomador: {
    tipoDocumentoCodigo: string;
    documentoNumero: string;
    nacionalidadCodigo: string;
    nombre: string;
    categoriaIVACodigo: string;
    calleNombre: string;
    calleNumero: string;
    callePiso?: string;
    calleDepto?: string;
    codigoPostal: string;
    subCodigoPostal: string;
    telefono: string;
    email: string;
    fechaNacimiento: string;  // YYYY/MM/DD
    sexo: string;             // 1=M, 2=F
    estadoCivilCodigo: string;
    lugarNacimiento: string;
  };
  aseguradoEsTomador: string;
  vehiculo: {
    patente: string;
    motor: string;
    chasis: string;
  };
}

export interface EmisionResponse {
  idServicioEmision: string;
  rama: string;
  poliza: string;
  endoso: string;
  estadoSolicitud: string;
  impuestos: string;
  premio: string;
  inspeccion: string;
  requiereInspeccion: string;
  excepciones: string;
  errores: string;
}

// ─── Rama Helpers ───────────────────────────────────────────────────────────

/** Resolve rama-specific defaults: TipoPolizaCodigo and PlanComercialCodigo */
export function getRamaDefaults(rama: string): { tipoPolizaCodigo: string; planComercialCodigo: string } {
  if (rama === '28') {
    return { tipoPolizaCodigo: 'MOT01', planComercialCodigo: 'MOTO' };
  }
  // rama 4 = autos (default)
  return { tipoPolizaCodigo: 'AUT01', planComercialCodigo: 'PLAN1' };
}

// ─── SOAP XML Builders ──────────────────────────────────────────────────────

function buildCotizacionSOAP(req: CotizacionRequest): string {
  const coberturasXml = req.coberturasCotizar
    ? `<tem:CoberturaCotizar>${req.coberturasCotizar.map(c => `
          <tem:CoberturaCotizarItem>
            <tem:Cobertura>${c.cobertura}</tem:Cobertura>
            <tem:PremioInformado>${c.premioInformado}</tem:PremioInformado>
          </tem:CoberturaCotizarItem>`).join('')}
        </tem:CoberturaCotizar>`
    : '<tem:CoberturaCotizar/>';

  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
   <soapenv:Header/>
   <soapenv:Body>
      <tem:WSCotizarAutomotores.Execute>
         <tem:Entserviciocotizacionautomotores>
            <tem:SistemaOrigen>${ANTARTIDA_SISTEMA_ORIGEN}</tem:SistemaOrigen>
            <tem:Rama>${req.rama}</tem:Rama>
            <tem:TipoPolizaCodigo>${req.tipoPolizaCodigo}</tem:TipoPolizaCodigo>
            <tem:TomadorNombre>${escapeXml(req.tomadorNombre)}</tem:TomadorNombre>
            <tem:TomadorCUIT>${req.tomadorCUIT}</tem:TomadorCUIT>
            <tem:TomadorTipoPersona>${req.tomadorTipoPersona}</tem:TomadorTipoPersona>
            <tem:TomadoCategoriaIVACodigo>${req.tomadorCategoriaIVA}</tem:TomadoCategoriaIVACodigo>
            <tem:TomadorIIBBCodigo/>
            <tem:VigenciaDesde>${req.vigenciaDesde}</tem:VigenciaDesde>
            <tem:ProductorCodigo>${req.productorCodigo || ANTARTIDA_PRODUCTOR_CODIGO}</tem:ProductorCodigo>
            <tem:MonedaCodigo/>
            <tem:PlanComercialCodigo>${req.planComercialCodigo}</tem:PlanComercialCodigo>
            <tem:FormaPagoCodigo>${req.formaPagoCodigo}</tem:FormaPagoCodigo>
            <tem:ModoFacturacionCodigo>${req.modoFacturacionCodigo}</tem:ModoFacturacionCodigo>
            <tem:CondicionPagoCodigo>${req.condicionPagoCodigo}</tem:CondicionPagoCodigo>
            <tem:CodigoPostal>${req.codigoPostal}</tem:CodigoPostal>
            <tem:SubCodigoPostal>${req.subCodigoPostal}</tem:SubCodigoPostal>
            <tem:MarcaCodigo>${req.marcaCodigo}</tem:MarcaCodigo>
            <tem:ModeloCodigo>${req.modeloCodigo}</tem:ModeloCodigo>
            <tem:SubModeloCodigo>${req.subModeloCodigo}</tem:SubModeloCodigo>
            <tem:CeroKM>${req.ceroKM || ''}</tem:CeroKM>
            <tem:AnioFabricacion>${req.anioFabricacion}</tem:AnioFabricacion>
            <tem:SumaAsegurada>${req.sumaAsegurada || '0'}</tem:SumaAsegurada>
            <tem:ClausulaAjusteCodigo/>
            <tem:AdicionalGranizoCodigo/>
            <tem:AdicionalGranizoSumaAsegurada/>
            <tem:PoseeEquipoRastreo/>
            <tem:EquipoRastreoCodigo/>
            <tem:PoseeEquipoGNC/>
            <tem:Accesorio1Codigo/>
            <tem:Accesorio1Valor/>
            <tem:Accesorio2Codigo/>
            <tem:Accesorio2Valor/>
            <tem:Accesorio3Codigo/>
            <tem:Accesorio3Valor/>
            <tem:Accesorio4Codigo/>
            <tem:Accesorio4Valor/>
            <tem:Accesorio5Codigo/>
            <tem:Accesorio5Valor/>
            <tem:CoberturaAdicional1Codigo/>
            <tem:CoberturaAdicional1Valor/>
            <tem:CoberturaAdicional2Codigo/>
            <tem:CoberturaAdicional2Valor/>
            <tem:CoberturaAdicional3Codigo/>
            <tem:CoberturaAdicional3Valor/>
            <tem:CoberturaAdicional4Codigo/>
            <tem:CoberturaAdicional4Valor/>
            <tem:CoberturaAdicional5Codigo/>
            <tem:CoberturaAdicional5Valor/>
            <tem:MultiproductoCotizar>${req.multiproductoCotizar || ''}</tem:MultiproductoCotizar>
            ${coberturasXml}
         </tem:Entserviciocotizacionautomotores>
      </tem:WSCotizarAutomotores.Execute>
   </soapenv:Body>
</soapenv:Envelope>`;
}

function buildEmisionSOAP(req: EmisionRequest): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
   <soapenv:Header/>
   <soapenv:Body>
      <tem:WSEmitirCotizacionAutomotores.Execute>
         <tem:Entservicioemisionautomotores>
            <tem:Rama>${req.rama}</tem:Rama>
            <tem:Solicitud>${req.solicitud}</tem:Solicitud>
            <tem:Instalacion>${req.instalacion}</tem:Instalacion>
            <tem:ItemSeleccionado>${req.itemSeleccionado}</tem:ItemSeleccionado>
            <tem:Cobertura>${req.cobertura || ''}</tem:Cobertura>
            <tem:Tomador>
               <tem:TipoDocumentoCodigo>${req.tomador.tipoDocumentoCodigo}</tem:TipoDocumentoCodigo>
               <tem:DocumentoNumero>${req.tomador.documentoNumero}</tem:DocumentoNumero>
               <tem:NacionalidadCodigo>${req.tomador.nacionalidadCodigo}</tem:NacionalidadCodigo>
               <tem:Nombre>${escapeXml(req.tomador.nombre)}</tem:Nombre>
               <tem:CategoriaIVACodigo>${req.tomador.categoriaIVACodigo}</tem:CategoriaIVACodigo>
               <tem:CalleNombre>${escapeXml(req.tomador.calleNombre)}</tem:CalleNombre>
               <tem:CalleNumero>${req.tomador.calleNumero}</tem:CalleNumero>
               <tem:CallePiso>${req.tomador.callePiso || ''}</tem:CallePiso>
               <tem:CalleDepto>${req.tomador.calleDepto || ''}</tem:CalleDepto>
               <tem:CodigoPostal>${req.tomador.codigoPostal}</tem:CodigoPostal>
               <tem:SubCodigoPostal>${req.tomador.subCodigoPostal}</tem:SubCodigoPostal>
               <tem:Telefono>${req.tomador.telefono}</tem:Telefono>
               <tem:EMail>${req.tomador.email}</tem:EMail>
               <tem:FechaNacimiento>${req.tomador.fechaNacimiento}</tem:FechaNacimiento>
               <tem:Sexo>${req.tomador.sexo}</tem:Sexo>
               <tem:EstadoCivilCodigo>${req.tomador.estadoCivilCodigo}</tem:EstadoCivilCodigo>
               <tem:LugarNacimiento>${escapeXml(req.tomador.lugarNacimiento)}</tem:LugarNacimiento>
               <tem:ConyugeNombre/>
               <tem:ConyugeTipoDocumentoCodigo/>
               <tem:ConyugeDocumentoNumero/>
               <tem:RelacionEmpleado/>
               <tem:EmpleadoLegajo/>
               <tem:PEP/>
               <tem:Cargo/>
               <tem:Organismo/>
               <tem:Relacion/>
               <tem:DeclaraTitular>S</tem:DeclaraTitular>
               <tem:DeclaranteNombre/>
               <tem:DeclaranteTipoDocumentoCodigo/>
               <tem:DeclaranteDocumentoNumero/>
               <tem:DeclaranteCaracter/>
               <tem:DeclaranteDenominacion/>
               <tem:DeclaranteCUIT/>
               <tem:DeclaranteObservaciones/>
               <tem:SujetoObligadoActividadCodigo/>
               <tem:SujetoObligadoActividadDetalle/>
               <tem:SujetoObligadoRazonSocial/>
               <tem:RepresentanteLegal>
                  <tem:TipoDocumentoCodigo/>
                  <tem:DocumentoNumero/>
                  <tem:Nombre/>
                  <tem:TipoPersona/>
                  <tem:CategoriaIVACodigo/>
                  <tem:CalleNombre/>
                  <tem:CalleNumero/>
                  <tem:CallePiso/>
                  <tem:CalleDepto/>
                  <tem:CodigoPostal/>
                  <tem:SubCodigoPostal/>
                  <tem:Telefono/>
                  <tem:FechaNacimiento/>
                  <tem:Sexo/>
                  <tem:EstadoCivilCodigo/>
                  <tem:LugarNacimiento/>
                  <tem:NacionalidadCodigo/>
               </tem:RepresentanteLegal>
            </tem:Tomador>
            <tem:AseguradoEsTomador>${req.aseguradoEsTomador}</tem:AseguradoEsTomador>
            <tem:Asegurado>
               <tem:TipoDocumentoCodigo/>
               <tem:DocumentoNumero/>
               <tem:TipoPersona/>
               <tem:NacionalidadCodigo/>
               <tem:Nombre/>
               <tem:CategoriaIVACodigo/>
               <tem:CalleNombre/>
               <tem:CalleNumero/>
               <tem:CallePiso/>
               <tem:CalleDepto/>
               <tem:CodigoPostal/>
               <tem:SubCodigoPostal/>
               <tem:Telefono/>
               <tem:EMail/>
               <tem:FechaNacimiento/>
               <tem:Sexo/>
               <tem:EstadoCivilCodigo/>
               <tem:LugarNacimiento/>
               <tem:RelacionEmpleado/>
               <tem:PEP/>
               <tem:Cargo/>
               <tem:Organismo/>
               <tem:Relacion/>
               <tem:DeclaraTitular/>
               <tem:DeclaranteNombre/>
               <tem:DeclaranteTipoDocumentoCodigo/>
               <tem:DeclaranteDocumentoNumero/>
               <tem:DeclaranteCaracter/>
               <tem:DeclaranteDenominacion/>
               <tem:DeclaranteCUIT/>
               <tem:DeclaranteObservaciones/>
               <tem:RepresentanteLegal>
                  <tem:TipoDocumentoCodigo/>
                  <tem:DocumentoNumero/>
                  <tem:Nombre/>
                  <tem:TipoPersona/>
                  <tem:CategoriaIVACodigo/>
                  <tem:CalleNombre/>
                  <tem:CalleNumero/>
                  <tem:CallePiso/>
                  <tem:CalleDepto/>
                  <tem:CodigoPostal/>
                  <tem:SubCodigoPostal/>
                  <tem:Telefono/>
                  <tem:FechaNacimiento/>
                  <tem:Sexo/>
                  <tem:EstadoCivilCodigo/>
                  <tem:LugarNacimiento/>
                  <tem:NacionalidadCodigo/>
               </tem:RepresentanteLegal>
            </tem:Asegurado>
            <tem:AseguradoRUTA/>
            <tem:FormaPagoTarjetaCodigo/>
            <tem:FormaPagoTarjetaNumero/>
            <tem:FormaPagoTarjetaBancoCodigo/>
            <tem:FormaPagoTarjetaVencimiento/>
            <tem:FormaPagoDebitoCBU/>
            <tem:FormaPagoDebitoBancoCodigo/>
            <tem:FormaPagoOBBancoCodigo/>
            <tem:FormaPagoOBSucursalCodigo/>
            <tem:FormaPagoOBOperatoriaId/>
            <tem:FormaPagoOBNumeroCuenta/>
            <tem:FormaPagoOBTipoCuenta/>
            <tem:FormaPagoOBTipoDocumentoCodigo/>
            <tem:FormaPagoOBNumeroDocumento/>
            <tem:FormaPagoOBNumeroContrato/>
            <tem:FormaPagoOBVencimientoContrato/>
            <tem:PaseCartera/>
            <tem:PaseCarteraVencimiento/>
            <tem:PaseCarteraPlanComercialCodigo/>
            <tem:PolizaElectronicaAceptar/>
            <tem:PolizaElectronicaEmail/>
            <tem:DocumentacionPresentadaListaMiembros/>
            <tem:DocumentacionPresentadaDDJJ/>
            <tem:DocumentacionPresentadaRespaldatoria/>
            <tem:DocumentacionPresentadaReferencias/>
            <tem:ConClausulaSubrogacion/>
            <tem:ClausulaSubrogacionId/>
            <tem:SubrogacionEmpresaBeneficiaria1/>
            <tem:SubrogacionEmpresaBeneficiaria2/>
            <tem:SubrogacionEmpresaBeneficiaria3/>
            <tem:SubrogacionEmpresaBeneficiaria4/>
            <tem:SubrogacionEmpresaBeneficiaria5/>
            <tem:Vehiculo>
               <tem:Patente>${req.vehiculo.patente}</tem:Patente>
               <tem:Motor>${req.vehiculo.motor}</tem:Motor>
               <tem:Chasis>${req.vehiculo.chasis}</tem:Chasis>
               <tem:EquipoGNCCodigo/>
               <tem:EquipoGNCIdentificacion/>
               <tem:RastreoIdentificacion/>
               <tem:RastreoDatosContacto1/>
               <tem:RastreoDatosContacto2/>
               <tem:RUTA/>
               <tem:PoseeAcreedorPrendario/>
               <tem:AcreedorPrendario>
                  <tem:TipoDocumentoCodigo/>
                  <tem:DocumentoNumero/>
                  <tem:Nombre/>
                  <tem:TipoPersona/>
                  <tem:CategoriaIVACodigo/>
                  <tem:CalleNombre/>
                  <tem:CalleNumero/>
                  <tem:CallePiso/>
                  <tem:CalleDepto/>
                  <tem:CodigoPostal/>
                  <tem:SubCodigoPostal/>
                  <tem:Telefono/>
                  <tem:FechaNacimiento/>
                  <tem:Sexo/>
                  <tem:EstadoCivilCodigo/>
                  <tem:LugarNacimiento/>
                  <tem:NacionalidadCodigo/>
               </tem:AcreedorPrendario>
            </tem:Vehiculo>
         </tem:Entservicioemisionautomotores>
      </tem:WSEmitirCotizacionAutomotores.Execute>
   </soapenv:Body>
</soapenv:Envelope>`;
}

// ─── XML Helpers ─────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getTagContent(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function getAllTagBlocks(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const blocks: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

// ─── SOAP API Callers ────────────────────────────────────────────────────────

function parseCotizacionResponse(xml: string): CotizacionResponse {
  const rama = getTagContent(xml, 'Rama');
  const solicitud = getTagContent(xml, 'Solicitud');
  const instalacion = getTagContent(xml, 'Instalacion');
  const descripcionVehiculo = getTagContent(xml, 'DescripcionVehiculo');

  // Extract the <Coberturas> wrapper block first
  const coberturasMatch = xml.match(/<Coberturas>([\s\S]*?)<\/Coberturas>/i);
  const coberturasXml = coberturasMatch ? coberturasMatch[1] : '';

  // Split into individual coverage blocks by finding top-level <Cobertura> elements
  // We can't use the generic getAllTagBlocks because there's a nested <Cobertura> child tag
  const coberturas: CotizacionResponse['coberturas'] = [];
  const blockStartRegex = /<Cobertura>\s*<Item>/gi;
  const starts: number[] = [];
  let match;
  while ((match = blockStartRegex.exec(coberturasXml)) !== null) {
    starts.push(match.index);
  }

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i < starts.length - 1 ? starts[i + 1] : coberturasXml.length;
    const block = coberturasXml.substring(start, end);

    coberturas.push({
      item: getTagContent(block, 'Item'),
      cobertura: getTagContent(block, 'Cobertura'),
      coberturaDsc: getTagContent(block, 'CoberturaDsc'),
      sumaAsegurada: getTagContent(block, 'SumaAsegurada'),
      prima: getTagContent(block, 'Prima'),
      porcBonificacion: getTagContent(block, 'PorcBonificacion'),
      bonificacion: getTagContent(block, 'Bonificacion'),
      porcRecargoAdministrativo: getTagContent(block, 'PorcRecargoAdministrativo'),
      recargoAdministrativo: getTagContent(block, 'RecargoAdministrativo'),
      recargoFinanciero: getTagContent(block, 'RecargoFinanciero'),
      derechoEmision: getTagContent(block, 'DerechoEmision'),
      impuestos: getTagContent(block, 'Impuestos'),
      premio: getTagContent(block, 'Premio'),
      importeCuota1: getTagContent(block, 'ImporteCuota1'),
      importeRestoCuotas: getTagContent(block, 'ImporteRestoCuotas'),
      comision: getTagContent(block, 'Comision'),
    });
  }

  console.log(`📊 Parsed ${coberturas.length} coverages:`, coberturas.map(c => ({ item: c.item, cobertura: c.cobertura, premio: c.premio, prima: c.prima })));

  return { rama, solicitud, instalacion, descripcionVehiculo, coberturas };
}

function parseEmisionResponse(xml: string): EmisionResponse {
  return {
    idServicioEmision: getTagContent(xml, 'IdServicioEmision'),
    rama: getTagContent(xml, 'Rama'),
    poliza: getTagContent(xml, 'Poliza'),
    endoso: getTagContent(xml, 'Endoso'),
    estadoSolicitud: getTagContent(xml, 'EstadoSolicitud'),
    impuestos: getTagContent(xml, 'Impuestos'),
    premio: getTagContent(xml, 'Premio'),
    inspeccion: getTagContent(xml, 'Inspeccion'),
    requiereInspeccion: getTagContent(xml, 'RequiereInspeccion'),
    excepciones: getTagContent(xml, 'Excepciones'),
    errores: getTagContent(xml, 'Errores'),
  };
}

async function callSOAP(url: string, soapBody: string, action: string): Promise<string> {
  console.log(`🔗 SOAP Call: ${action} → ${url}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${action}"`,
    },
    body: soapBody,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ SOAP Error (${response.status}):`, errorText.substring(0, 500));
    throw new Error(`SOAP request failed: ${response.status} ${response.statusText}`);
  }

  const responseXml = await response.text();
  console.log(`✅ SOAP Response received (${responseXml.length} chars)`);
  return responseXml;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function cotizarAutomotor(req: CotizacionRequest): Promise<CotizacionResponse> {
  const soapBody = buildCotizacionSOAP(req);
  const responseXml = await callSOAP(
    ANTARTIDA_WSDL_URL,
    soapBody,
    'http://tempuri.org/WSCotizarAutomotores.Execute',
  );
  // Debug: log a portion of the response around coverage data
  const cobIdx = responseXml.indexOf('obertura');
  if (cobIdx > -1) {
    console.log('🔍 SOAP Coverage XML sample:', responseXml.substring(Math.max(0, cobIdx - 50), Math.min(responseXml.length, cobIdx + 500)));
  } else {
    console.log('🔍 SOAP Response (first 2000 chars):', responseXml.substring(0, 2000));
  }
  return parseCotizacionResponse(responseXml);
}

export async function emitirCotizacion(req: EmisionRequest): Promise<EmisionResponse> {
  const soapBody = buildEmisionSOAP(req);
  const responseXml = await callSOAP(
    ANTARTIDA_EMISION_URL,
    soapBody,
    'http://tempuri.org/WSEmitirCotizacionAutomotores.Execute',
  );
  return parseEmisionResponse(responseXml);
}

// Parse vehicle description from Antártida response into structured data
// Example: "CITROEN-C 3 1.5I ORIGINE PACK ZENITH 2017" → { make: "CITROEN", model: "C 3 1.5I ORIGINE PACK ZENITH", year: 2017 }
export function parseVehicleDescription(desc: string): { make: string; model: string; year?: number } {
  if (!desc) return { make: '-', model: '-' };

  const dashIndex = desc.indexOf('-');
  if (dashIndex === -1) return { make: desc, model: '-' };

  const make = desc.substring(0, dashIndex).trim();
  const rest = desc.substring(dashIndex + 1).trim();

  // Try to extract year from the end
  const yearMatch = rest.match(/\s(\d{4})$/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    const model = rest.substring(0, rest.length - yearMatch[0].length).trim();
    return { make, model, year };
  }

  return { make, model: rest };
}
