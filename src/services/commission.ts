import { supabaseAdmin } from '../config/supabase';

export async function calculateCommission(quoteId: string, policyId: string): Promise<void> {
  try {
    // Get quote and producer info
    const { data: quote } = await supabaseAdmin
      .from('quotes')
      .select('*, producer:profiles!producer_id(*)')
      .eq('id', quoteId)
      .single();

    if (!quote || !quote.premium) {
      throw new Error('Quote not found or missing premium');
    }

    const producer = quote.producer;
    if (!producer) {
      throw new Error('Producer not found');
    }

    const rate = producer.commission_rate || 0.1;
    const amount = Number(quote.premium) * Number(rate);
    const now = new Date();

    // Create commission entry
    await supabaseAdmin.from('commission_entries').insert({
      producer_id: quote.producer_id,
      policy_id: policyId,
      quote_id: quoteId,
      amount: amount,
      rate: rate,
      premium: quote.premium,
      status: 'due',
      period_month: now.getMonth() + 1,
      period_year: now.getFullYear(),
    });

    // Notify producer about commission
    await supabaseAdmin.from('notifications').insert({
      user_id: quote.producer_id,
      title: 'Nueva comisión generada',
      title_en: 'New commission generated',
      body: `Se generó una comisión de $${amount.toFixed(2)} por la póliza aprobada.`,
      body_en: `A commission of $${amount.toFixed(2)} was generated for the approved policy.`,
      type: 'commission_paid',
      data: { quote_id: quoteId, policy_id: policyId, amount },
    });
  } catch (error) {
    console.error('Commission calculation error:', error);
    throw error;
  }
}

export async function getProducerCommissionSummary(producerId: string) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // Monthly total
  const { data: monthlyData } = await supabaseAdmin
    .from('commission_entries')
    .select('amount, status')
    .eq('producer_id', producerId)
    .eq('period_month', currentMonth)
    .eq('period_year', currentYear);

  const monthlyTotal = monthlyData?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
  const monthlyDue = monthlyData?.filter(e => e.status === 'due').reduce((sum, e) => sum + Number(e.amount), 0) || 0;
  const monthlyPaid = monthlyData?.filter(e => e.status === 'paid').reduce((sum, e) => sum + Number(e.amount), 0) || 0;

  // All time total
  const { data: allTimeData } = await supabaseAdmin
    .from('commission_entries')
    .select('amount, status')
    .eq('producer_id', producerId);

  const allTimeTotal = allTimeData?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
  const allTimeDue = allTimeData?.filter(e => e.status === 'due').reduce((sum, e) => sum + Number(e.amount), 0) || 0;
  const allTimePaid = allTimeData?.filter(e => e.status === 'paid').reduce((sum, e) => sum + Number(e.amount), 0) || 0;

  return {
    monthly: { total: monthlyTotal, due: monthlyDue, paid: monthlyPaid, month: currentMonth, year: currentYear },
    allTime: { total: allTimeTotal, due: allTimeDue, paid: allTimePaid },
    count: allTimeData?.length || 0,
  };
}
