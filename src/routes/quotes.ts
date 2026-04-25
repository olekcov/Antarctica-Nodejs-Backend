import { Router, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, requireApproved, AuthRequest } from '../middleware/auth';
import { validateQuote } from '../services/ai-validation';
import { cotizarAutomotor, parseVehicleDescription, getRamaDefaults } from '../services/antartida-api';
import { fullLookup, lookupInfoAuto, lookupPostalCodeByAddress, lookupPostalCodeByCode } from '../services/antemi-api';
import { generateMotor, generateChasis } from '../services/relaxit-api';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// All routes require authentication
router.use(authenticate);
router.use(requireApproved);

// POST /quotes - Create draft
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { vehicle_plate, customer_dni } = req.body;

    const { data, error } = await supabaseAdmin
      .from('quotes')
      .insert({
        producer_id: req.user!.id,
        vehicle_plate: vehicle_plate?.toUpperCase(),
        customer_dni,
        status: 'draft',
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Log action
    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'create_quote',
      entity_type: 'quote',
      entity_id: data.id,
      new_data: { vehicle_plate, customer_dni },
    });

    res.status(201).json({ quote: data });
  } catch (error) {
    console.error('Create quote error:', error);
    res.status(500).json({ error: 'Failed to create quote' });
  }
});

// POST /quotes/:id/retrieve-data
// Calls Antemi API to get vehicle + person + InfoAuto codes + postal code
router.post('/:id/retrieve-data', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Verify quote belongs to producer
    const { data: quote } = await supabaseAdmin
      .from('quotes')
      .select('*')
      .eq('id', id)
      .eq('producer_id', req.user!.id)
      .single();

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Call Antemi full lookup: plate → vehicle + person + InfoAuto codes + postal code
    const result = await fullLookup(
      quote.vehicle_plate || '',
      quote.customer_dni || '',
    );

    // Generate motor + chasis for emission
    const motor = generateMotor();
    const chasis = generateChasis();

    // Store the retrieved data on the quote
    await supabaseAdmin
      .from('quotes')
      .update({
        vehicle_data: {
          ...(quote.vehicle_data || {}),
          antemi: result,
          motor,
          chasis,
          // Store GLM-ready codes from InfoAuto
          ...(result.infoAuto ? {
            marcaCodigo: result.infoAuto.marcaCodigo,
            modeloCodigo: result.infoAuto.modeloCodigo,
            subModeloCodigo: result.infoAuto.subModeloCodigo,
          } : {}),
        },
      })
      .eq('id', id);

    // Update customer record if person data found
    if (result.person && quote.customer_dni) {
      await supabaseAdmin
        .from('customers')
        .upsert({
          dni: quote.customer_dni,
          full_name: result.person.fullName,
          phone: result.person.telefono,
          email: result.person.email,
          date_of_birth: result.person.fechaNacimiento || null,
          sex: result.person.sexo || null,
          postal_code: result.person.codigoPostal || null,
          city: result.person.localidad || null,
          province: result.person.provincia || null,
          street_name: result.person.calleNombre || null,
          street_number: result.person.calleNumero || null,
          floor: result.person.callePiso || null,
          apartment: result.person.calleDepto || null,
          created_by: req.user!.id,
        }, { onConflict: 'dni' });
    }

    res.json({
      found: result.found,
      vehicle: result.vehicle,
      person: result.person,
      infoAuto: result.infoAuto,
      postalCode: result.postalCode,
      motor,
      chasis,
      source: result.source,
    });
  } catch (error) {
    console.error('Retrieve data error:', error);
    res.status(500).json({ error: 'Failed to retrieve data' });
  }
});

// POST /quotes/:id/vehicle-lookup
// Accepts dynamic SOAP API parameters from the mobile app
router.post('/:id/vehicle-lookup', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      marcaCodigo, modeloCodigo, subModeloCodigo, anioFabricacion,
      vehicleMarca, vehicleModelo,
      codigoPostal, subCodigoPostal, sumaAsegurada,
      ceroKM, tomadorNombre, planComercialCodigo,
      formaPagoCodigo, modoFacturacionCodigo, condicionPagoCodigo,
      rama: requestRama,
    } = req.body;

    // Resolve rama: 4 = autos (default), 28 = motovehiculos
    const rama = requestRama || '4';
    const ramaDefaults = getRamaDefaults(rama);

    // If internal codes are missing, try to resolve them via Antemi InfoAuto
    if (!marcaCodigo || !modeloCodigo) {
      if (vehicleMarca && vehicleModelo && anioFabricacion) {
        console.log(`🔄 Vehicle codes missing — resolving via Antemi InfoAuto: ${vehicleMarca} ${vehicleModelo} ${anioFabricacion}`);
        const infoAutoResult = await lookupInfoAuto(vehicleMarca, vehicleModelo, anioFabricacion);
        if (infoAutoResult) {
          // Retry with resolved codes by reassigning and falling through
          req.body.marcaCodigo = infoAutoResult.marcaCodigo;
          req.body.modeloCodigo = infoAutoResult.modeloCodigo;
          req.body.subModeloCodigo = infoAutoResult.subModeloCodigo;
          // Re-read from body for the SOAP call below
          Object.assign(req.body, {
            marcaCodigo: infoAutoResult.marcaCodigo,
            modeloCodigo: infoAutoResult.modeloCodigo,
            subModeloCodigo: infoAutoResult.subModeloCodigo,
          });
        } else {
          return res.status(400).json({
            error: 'No se pudieron resolver los códigos del vehículo. Verifique marca, modelo y año.',
          });
        }
      } else {
        return res.status(400).json({
          error: 'Faltan códigos de vehículo (marcaCodigo/modeloCodigo). Proporcione marca, modelo y año para resolverlos automáticamente.',
        });
      }
    }

    // Re-read codes (may have been resolved by InfoAuto above)
    const resolvedMarcaCodigo = req.body.marcaCodigo || marcaCodigo;
    const resolvedModeloCodigo = req.body.modeloCodigo || modeloCodigo;
    const resolvedSubModeloCodigo = req.body.subModeloCodigo || subModeloCodigo;

    if (!anioFabricacion) {
      return res.status(400).json({ error: 'Missing required field: anioFabricacion' });
    }

    // Verify quote belongs to producer
    const { data: quote } = await supabaseAdmin
      .from('quotes')
      .select('*')
      .eq('id', id)
      .eq('producer_id', req.user!.id)
      .single();

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    let vehicleData: any = {
      plate: quote.vehicle_plate,
      make: vehicleMarca || '',
      model: vehicleModelo || '',
      year: parseInt(anioFabricacion, 10) || null,
      color: '',
      vehicle_type: '',
      fuel_type: '',
      api_source: 'none',
    };
    let coberturas: any[] = [];
    let apiMeta: any = {};

    // Call Antártida SOAP API with dynamic parameters
    try {
      const today = new Date();
      const vigencia = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;

      const cotizacionResult = await cotizarAutomotor({
        rama,
        tipoPolizaCodigo: ramaDefaults.tipoPolizaCodigo,
        tomadorNombre: tomadorNombre || 'CONSULTA',
        tomadorCUIT: '',
        tomadorTipoPersona: '1',
        tomadorCategoriaIVA: '5',
        vigenciaDesde: vigencia,
        planComercialCodigo: planComercialCodigo || ramaDefaults.planComercialCodigo,
        formaPagoCodigo: formaPagoCodigo || '0',
        modoFacturacionCodigo: modoFacturacionCodigo || '03',
        condicionPagoCodigo: condicionPagoCodigo || '203',
        codigoPostal: codigoPostal || '1000',
        subCodigoPostal: subCodigoPostal || '1',
        marcaCodigo: resolvedMarcaCodigo,
        modeloCodigo: resolvedModeloCodigo,
        subModeloCodigo: resolvedSubModeloCodigo || '1',
        ceroKM: ceroKM || 'false',
        anioFabricacion,
        sumaAsegurada: sumaAsegurada || '0',
      });

      if (cotizacionResult.descripcionVehiculo) {
        const parsed = parseVehicleDescription(cotizacionResult.descripcionVehiculo);
        vehicleData = {
          ...vehicleData,
          make: parsed.make,
          model: parsed.model,
          year: parsed.year || parseInt(anioFabricacion, 10) || null,
          api_source: 'antartida',
          api_descripcion: cotizacionResult.descripcionVehiculo,
        };
        coberturas = cotizacionResult.coberturas || [];
        apiMeta = {
          solicitud: cotizacionResult.solicitud,
          instalacion: cotizacionResult.instalacion,
          rama: cotizacionResult.rama,
        };
        console.log(`✅ Antártida API returned: ${cotizacionResult.descripcionVehiculo} (${coberturas.length} coverages)`);
      }
    } catch (apiError: any) {
      console.warn(`⚠️ Antártida API lookup failed: ${apiError.message}`);
      return res.status(502).json({
        error: 'API de Antártida no disponible',
        details: apiError.message,
      });
    }

    // Upsert vehicle
    const { data: vehicle } = await supabaseAdmin
      .from('vehicles')
      .upsert({
        plate: quote.vehicle_plate,
        make: vehicleData.make || null,
        model: vehicleData.model || null,
        year: vehicleData.year || null,
        color: vehicleData.color || null,
        vehicle_type: vehicleData.vehicle_type || null,
        fuel_type: vehicleData.fuel_type || null,
        extra_data: {
          api_source: vehicleData.api_source,
          api_descripcion: vehicleData.api_descripcion,
          marcaCodigo: resolvedMarcaCodigo, modeloCodigo: resolvedModeloCodigo, subModeloCodigo: resolvedSubModeloCodigo,
        },
      }, { onConflict: 'plate' })
      .select()
      .single();

    // Customer lookup
    let customerData = null;
    if (quote.customer_dni) {
      const { data: existingCustomer } = await supabaseAdmin
        .from('customers')
        .select('*')
        .eq('dni', quote.customer_dni)
        .single();

      customerData = existingCustomer || {
        dni: quote.customer_dni,
        full_name: '',
        needs_completion: true,
      };
    }

    // Update quote with vehicle data + API meta
    await supabaseAdmin
      .from('quotes')
      .update({
        vehicle_id: vehicle?.id,
        vehicle_data: {
          ...vehicleData,
          coberturas,
          api_meta: apiMeta,
          soap_params: { marcaCodigo: resolvedMarcaCodigo, modeloCodigo: resolvedModeloCodigo, subModeloCodigo: resolvedSubModeloCodigo, anioFabricacion, codigoPostal, sumaAsegurada },
        },
      })
      .eq('id', id);

    res.json({
      vehicle: vehicleData,
      customer: customerData,
      coberturas,
      api_meta: apiMeta,
    });
  } catch (error) {
    console.error('Vehicle lookup error:', error);
    res.status(500).json({ error: 'Vehicle lookup failed' });
  }
});

// PATCH /quotes/:id/vehicle - Update vehicle data manually (when API data is wrong)
router.patch('/:id/vehicle', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { make, model, year } = req.body;

    // Verify quote belongs to producer
    const { data: quote } = await supabaseAdmin
      .from('quotes')
      .select('*')
      .eq('id', id)
      .eq('producer_id', req.user!.id)
      .in('status', ['draft', 'needs_fix'])
      .single();

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found or not editable' });
    }

    const updatedVehicleData = {
      ...(quote.vehicle_data || {}),
      plate: quote.vehicle_plate,
      make: make || '',
      model: model || '',
      year: year ? parseInt(year, 10) : null,
      manually_edited: true,
    };

    // Update vehicle record
    if (quote.vehicle_id) {
      await supabaseAdmin
        .from('vehicles')
        .update({ make, model, year: year ? parseInt(year, 10) : null })
        .eq('id', quote.vehicle_id);
    } else if (quote.vehicle_plate) {
      const { data: vehicle } = await supabaseAdmin
        .from('vehicles')
        .upsert({
          plate: quote.vehicle_plate,
          make,
          model,
          year: year ? parseInt(year, 10) : null,
        }, { onConflict: 'plate' })
        .select()
        .single();

      if (vehicle) {
        await supabaseAdmin
          .from('quotes')
          .update({ vehicle_id: vehicle.id })
          .eq('id', id);
      }
    }

    // Update quote vehicle_data
    await supabaseAdmin
      .from('quotes')
      .update({ vehicle_data: updatedVehicleData })
      .eq('id', id);

    res.json({ vehicle: updatedVehicleData });
  } catch (error) {
    console.error('Update vehicle error:', error);
    res.status(500).json({ error: 'Failed to update vehicle data' });
  }
});

// GET /quotes/plans - Get available insurance plans
router.get('/plans', async (_req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('insurance_plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ plans: data });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ error: 'Failed to get plans' });
  }
});

// POST /quotes/:id/select-plan
// Accepts either a local plan_id OR an API coverage selection
router.post('/:id/select-plan', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { plan_id, coverage_selection, customer_data } = req.body;

    // Verify quote
    const { data: quote } = await supabaseAdmin
      .from('quotes')
      .select('*')
      .eq('id', id)
      .eq('producer_id', req.user!.id)
      .in('status', ['draft', 'needs_fix'])
      .single();

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found or not editable' });
    }

    // Resolve plan data — either from local DB or API coverage
    let planData: any = {};
    let premium = 0;
    let resolvedPlanId = plan_id || null;

    if (coverage_selection) {
      // API coverage selection from Antártida
      planData = {
        source: 'antartida_api',
        item: coverage_selection.item,
        cobertura: coverage_selection.cobertura,
        coberturaDsc: coverage_selection.coberturaDsc,
        sumaAsegurada: coverage_selection.sumaAsegurada,
        prima: coverage_selection.prima,
        premio: coverage_selection.premio,
        importeCuota1: coverage_selection.importeCuota1,
        importeRestoCuotas: coverage_selection.importeRestoCuotas,
        comision: coverage_selection.comision,
        bonificacion: coverage_selection.bonificacion,
        porcBonificacion: coverage_selection.porcBonificacion,
        derechoEmision: coverage_selection.derechoEmision,
        impuestos: coverage_selection.impuestos,
      };
      premium = parseFloat(coverage_selection.premio) || 0;
      // Store API meta from the quote's vehicle_data
      if (quote.vehicle_data?.api_meta) {
        planData.api_meta = quote.vehicle_data.api_meta;
      }
    } else if (plan_id) {
      // Local plan selection (fallback)
      const { data: plan } = await supabaseAdmin
        .from('insurance_plans')
        .select('*')
        .eq('id', plan_id)
        .eq('is_active', true)
        .single();

      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      planData = { source: 'local', name: plan.name, code: plan.code, coverage_type: plan.coverage_type };
      premium = plan.base_premium;
    } else {
      return res.status(400).json({ error: 'Either plan_id or coverage_selection is required' });
    }

    // Create/update customer
    let customerId = quote.customer_id;
    if (customer_data && quote.customer_dni) {
      const { data: customer } = await supabaseAdmin
        .from('customers')
        .upsert({
          ...(customerId ? { id: customerId } : {}),
          dni: quote.customer_dni,
          full_name: customer_data.full_name,
          email: customer_data.email,
          phone: customer_data.phone,
          address: customer_data.address,
          date_of_birth: customer_data.date_of_birth || null,
          sex: customer_data.sex || null,
          postal_code: customer_data.postal_code || null,
          city: customer_data.city || null,
          province: customer_data.province || null,
          street_name: customer_data.street_name || null,
          street_number: customer_data.street_number || null,
          floor: customer_data.floor || null,
          apartment: customer_data.apartment || null,
          created_by: req.user!.id,
        }, { onConflict: 'dni' })
        .select()
        .single();

      customerId = customer?.id;
    }

    // Update quote
    const { data: updatedQuote, error } = await supabaseAdmin
      .from('quotes')
      .update({
        plan_id: resolvedPlanId,
        customer_id: customerId,
        premium,
        customer_data: customer_data || quote.customer_data,
        plan_data: planData,
        status: 'pending_uploads',
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ quote: updatedQuote });
  } catch (error) {
    console.error('Select plan error:', error);
    res.status(500).json({ error: 'Failed to select plan' });
  }
});

// POST /quotes/:id/photos - Upload photos
router.post('/:id/photos', upload.single('photo'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { photo_type } = req.body;

    console.log(`📸 Photo upload: quote=${id}, type=${photo_type}, file=${req.file ? `${req.file.size} bytes` : 'MISSING'}`);

    if (!req.file) {
      console.log('❌ No file in request');
      return res.status(400).json({ error: 'No photo file provided' });
    }

    const validTypes = ['plate', 'front', 'rear', 'left', 'right', 'license_front', 'license_back'];
    if (!validTypes.includes(photo_type)) {
      console.log(`❌ Invalid photo_type: "${photo_type}"`);
      return res.status(400).json({ error: `Invalid photo type: "${photo_type}". Valid: ${validTypes.join(', ')}` });
    }

    // Verify quote
    const { data: quote, error: quoteError } = await supabaseAdmin
      .from('quotes')
      .select('*')
      .eq('id', id)
      .eq('producer_id', req.user!.id)
      .in('status', ['draft', 'pending_uploads', 'needs_fix'])
      .single();

    if (!quote) {
      console.log(`❌ Quote not found or not uploadable. Error: ${quoteError?.message}`);
      return res.status(404).json({ error: 'Quote not found or not uploadable' });
    }

    // Server-side duplicate image detection via SHA-256
    const contentHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const { data: existingPhotos } = await supabaseAdmin
      .from('quote_photos')
      .select('photo_type, metadata')
      .eq('quote_id', id)
      .neq('photo_type', photo_type);

    const duplicatePhoto = existingPhotos?.find(
      (p: any) => p.metadata?.content_hash === contentHash
    );
    if (duplicatePhoto) {
      console.log(`❌ Duplicate image detected: same content as "${duplicatePhoto.photo_type}" photo`);
      return res.status(400).json({
        error: `Duplicate image detected. This image is the same as the "${duplicatePhoto.photo_type}" photo. Please use a different image.`,
        duplicate_of: duplicatePhoto.photo_type,
      });
    }

    // Ensure storage bucket exists
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.name === 'quote-photos');
    if (!bucketExists) {
      console.log('📦 Creating storage bucket "quote-photos"...');
      const { error: bucketError } = await supabaseAdmin.storage.createBucket('quote-photos', {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      });
      if (bucketError) {
        console.error('❌ Failed to create bucket:', bucketError);
        return res.status(500).json({ error: `Storage bucket creation failed: ${bucketError.message}` });
      }
      console.log('✅ Bucket "quote-photos" created');
    }

    // Upload to Supabase Storage
    const fileName = `${id}/${photo_type}_${Date.now()}.jpg`;
    console.log(`📤 Uploading to storage: ${fileName} (${req.file.size} bytes, ${req.file.mimetype})`);

    const { error: uploadError } = await supabaseAdmin.storage
      .from('quote-photos')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      console.error('❌ Storage upload failed:', uploadError);
      return res.status(500).json({ error: `Photo upload failed: ${uploadError.message}` });
    }
    console.log('✅ File uploaded to storage');

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('quote-photos')
      .getPublicUrl(fileName);

    console.log(`🔗 Public URL: ${urlData.publicUrl}`);

    // Remove existing photo of same type
    await supabaseAdmin
      .from('quote_photos')
      .delete()
      .eq('quote_id', id)
      .eq('photo_type', photo_type);

    // Create photo record
    const { data: photo, error: photoError } = await supabaseAdmin
      .from('quote_photos')
      .insert({
        quote_id: id,
        photo_type,
        storage_path: fileName,
        storage_url: urlData.publicUrl,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
        metadata: { ...(req.body.metadata ? JSON.parse(req.body.metadata) : {}), content_hash: contentHash },
        exif_data: req.body.exif_data ? JSON.parse(req.body.exif_data) : {},
      })
      .select()
      .single();

    if (photoError) {
      console.error('❌ DB insert failed:', photoError);
      return res.status(400).json({ error: photoError.message });
    }

    console.log(`✅ Photo record created: ${photo.id}`);
    res.status(201).json({ photo });
  } catch (error) {
    console.error('❌ Photo upload exception:', error);
    res.status(500).json({ error: 'Photo upload failed' });
  }
});

// POST /quotes/:id/submit
router.post('/:id/submit', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { gps_lat, gps_lng, gps_accuracy, client_timestamp } = req.body;

    // Verify quote
    const { data: quote } = await supabaseAdmin
      .from('quotes')
      .select('*, photos:quote_photos(photo_type)')
      .eq('id', id)
      .eq('producer_id', req.user!.id)
      .in('status', ['pending_uploads', 'needs_fix'])
      .single();

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found or not submittable' });
    }

    // Check required photos
    const requiredTypes = ['plate', 'front', 'rear', 'left', 'right', 'license_front', 'license_back'];
    const uploadedTypes = quote.photos?.map((p: { photo_type: string }) => p.photo_type) || [];
    const missing = requiredTypes.filter(t => !uploadedTypes.includes(t));

    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Missing required photos',
        missing_photos: missing,
      });
    }

    // Update quote
    const { data: updatedQuote, error } = await supabaseAdmin
      .from('quotes')
      .update({
        status: 'processing_ai',
        gps_lat,
        gps_lng,
        gps_accuracy,
        client_timestamp,
        captured_at: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Trigger AI validation asynchronously
    validateQuote(id as string).catch(err => {
      console.error('AI validation async error:', err);
    });

    res.json({ quote: updatedQuote, message: 'Quote submitted for AI validation' });
  } catch (error) {
    console.error('Submit quote error:', error);
    res.status(500).json({ error: 'Failed to submit quote' });
  }
});

// GET /quotes/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const isAdmin = ['admin', 'supervisor', 'finance'].includes(req.user!.role);

    let query = supabaseAdmin
      .from('quotes')
      .select(`
        *,
        plan:insurance_plans(*),
        photos:quote_photos(*),
        customer:customers(*),
        vehicle:vehicles(*),
        producer:profiles!producer_id(id, full_name, email, commission_rate)
      `)
      .eq('id', id);

    if (!isAdmin) {
      query = query.eq('producer_id', req.user!.id);
    }

    const { data, error } = await query.single();

    if (error || !data) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    res.json({ quote: data });
  } catch (error) {
    console.error('Get quote error:', error);
    res.status(500).json({ error: 'Failed to get quote' });
  }
});

// DELETE /quotes/:id - Delete a draft quote
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Verify quote belongs to producer and is deletable
    const { data: quote } = await supabaseAdmin
      .from('quotes')
      .select('*')
      .eq('id', id)
      .eq('producer_id', req.user!.id)
      .in('status', ['draft', 'pending_uploads'])
      .single();

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found or cannot be deleted' });
    }

    // Delete associated photos first
    await supabaseAdmin.from('quote_photos').delete().eq('quote_id', id);

    // Delete the quote
    const { error } = await supabaseAdmin.from('quotes').delete().eq('id', id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Audit log
    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'delete_quote',
      entity_type: 'quote',
      entity_id: id,
      old_data: { quote_number: quote.quote_number, vehicle_plate: quote.vehicle_plate },
    });

    console.log(`🗑️ Quote ${quote.quote_number} deleted by ${req.user!.email}`);
    res.json({ success: true, message: 'Quote deleted' });
  } catch (error) {
    console.error('Delete quote error:', error);
    res.status(500).json({ error: 'Failed to delete quote' });
  }
});

// GET /quotes/:id/ai-results
router.get('/:id/ai-results', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data: quote } = await supabaseAdmin
      .from('quotes')
      .select('ai_status, ai_score, ai_flags, ai_summary')
      .eq('id', id)
      .single();

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const { data: photos } = await supabaseAdmin
      .from('quote_photos')
      .select('photo_type, quality_score, ocr_text, validation_flags, ai_analysis')
      .eq('quote_id', id);

    res.json({
      ai_status: quote.ai_status,
      ai_score: quote.ai_score,
      ai_flags: quote.ai_flags,
      ai_summary: quote.ai_summary,
      photo_analysis: photos,
    });
  } catch (error) {
    console.error('Get AI results error:', error);
    res.status(500).json({ error: 'Failed to get AI results' });
  }
});

export default router;
