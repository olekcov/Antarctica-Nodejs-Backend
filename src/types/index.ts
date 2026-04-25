// ============================================================
// Antártida Backend - Type Definitions
// ============================================================

export type UserRole = 'producer' | 'admin' | 'supervisor' | 'finance';
export type UserStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type QuoteStatus = 'draft' | 'pending_uploads' | 'processing_ai' | 'pending_review' | 'approved' | 'rejected' | 'needs_fix';
export type AIStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type PhotoType = 'plate' | 'front' | 'rear' | 'left' | 'right' | 'license_front' | 'license_back';
export type CommissionStatus = 'due' | 'paid';
export type PolicyStatus = 'pending' | 'active' | 'cancelled' | 'expired';
export type CoverageType = 'basic' | 'standard' | 'premium' | 'full';
export type NotificationType = 'account_approved' | 'account_rejected' | 'quote_approved' | 'quote_rejected' | 'quote_needs_fix' | 'commission_paid' | 'general';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
  commission_rate: number;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  avatar_url?: string;
  push_token?: string;
  locale: 'es' | 'en';
  theme: 'light' | 'dark' | 'system';
  created_at: string;
  updated_at: string;
  approved_at?: string;
  approved_by?: string;
}

export interface Customer {
  id: string;
  dni: string;
  full_name: string;
  email?: string;
  phone?: string;
  address?: string;
  date_of_birth?: string;
  sex?: 'M' | 'F';
  postal_code?: string;
  city?: string;
  province?: string;
  street_name?: string;
  street_number?: string;
  floor?: string;
  apartment?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Vehicle {
  id: string;
  plate: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  vehicle_type?: string;
  fuel_type?: string;
  extra_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface InsurancePlan {
  id: string;
  name: string;
  name_en?: string;
  code: string;
  description?: string;
  description_en?: string;
  base_premium: number;
  coverage_type: CoverageType;
  coverage_details: Record<string, unknown>;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Quote {
  id: string;
  quote_number: string;
  producer_id: string;
  customer_id?: string;
  vehicle_id?: string;
  plan_id?: string;
  status: QuoteStatus;
  premium?: number;
  customer_dni?: string;
  vehicle_plate?: string;
  customer_data: Record<string, unknown>;
  vehicle_data: Record<string, unknown>;
  plan_data: Record<string, unknown>;
  gps_lat?: number;
  gps_lng?: number;
  gps_accuracy?: number;
  captured_at?: string;
  client_timestamp?: string;
  ai_status: AIStatus;
  ai_score?: number;
  ai_flags: unknown[];
  ai_summary?: string;
  admin_notes?: string;
  rejection_reason?: string;
  fix_instructions?: string;
  submitted_at?: string;
  reviewed_at?: string;
  reviewed_by?: string;
  created_at: string;
  updated_at: string;
}

export interface QuotePhoto {
  id: string;
  quote_id: string;
  photo_type: PhotoType;
  storage_path: string;
  storage_url?: string;
  file_size?: number;
  mime_type: string;
  metadata: Record<string, unknown>;
  exif_data: Record<string, unknown>;
  quality_score?: number;
  ocr_text?: string;
  validation_flags: unknown[];
  ai_analysis: Record<string, unknown>;
  created_at: string;
}

export interface Policy {
  id: string;
  quote_id: string;
  policy_number?: string;
  producer_id: string;
  insurer_status: PolicyStatus;
  start_date?: string;
  end_date?: string;
  premium?: number;
  created_at: string;
  updated_at: string;
}

export interface CommissionEntry {
  id: string;
  producer_id: string;
  policy_id: string;
  quote_id: string;
  amount: number;
  rate: number;
  premium: number;
  status: CommissionStatus;
  period_month?: number;
  period_year?: number;
  paid_at?: string;
  paid_by?: string;
  notes?: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  title_en?: string;
  body: string;
  body_en?: string;
  type: NotificationType;
  data: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

// Request types
export interface AuthenticatedRequest extends Express.Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    status: UserStatus;
  };
}

export interface AIValidationResult {
  score: number;
  flags: Array<{
    type: string;
    severity: 'critical' | 'warning' | 'info';
    message: string;
    details?: Record<string, unknown>;
  }>;
  plateOcrText?: string;
  plateMatch: boolean;
  photoQuality: Record<string, number>;
  summary: string;
  autoBlock: boolean;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    calls: number;
  };
  checkpoints?: string[];
}
