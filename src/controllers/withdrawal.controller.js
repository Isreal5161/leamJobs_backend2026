import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { assertPaystackWebhookSignature } from '../services/paystack.service.js';
import { executePendingWithdrawals, executeWithdrawal, reconcilePendingWithdrawals, reconcileWithdrawal } from '../services/withdrawalExecution.service.js';

export const paystackWithdrawalWebhook = async (req, res, next) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
    assertPaystackWebhookSignature(req.get('x-paystack-signature'), rawBody);
    const payload = JSON.parse(rawBody.toString('utf8'));
    const eventId = payload?.id ?? payload?.data?.id ?? payload?.data?.transfer_code ?? payload?.data?.reference;
    const providerReference = payload?.data?.reference;
    if (!eventId || !providerReference) return res.status(400).json({ message: 'Incomplete Paystack webhook payload' });
    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
    try {
      await prisma.providerWebhookEvent.create({ data: { provider: 'PAYSTACK', providerEventId: String(eventId), eventType: payload.event || null, payloadHash } });
    } catch (error) {
      if (error?.code === 'P2002') return res.status(200).json({ success: true, data: { duplicate: true } });
      throw error;
    }
    const withdrawal = await prisma.withdrawal.findUnique({ where: { providerReference }, select: { id: true } });
    if (!withdrawal) return res.status(200).json({ success: true, data: { ignored: true } });
    try {
      const result = await reconcileWithdrawal(withdrawal.id);
      await prisma.providerWebhookEvent.update({ where: { provider_providerEventId: { provider: 'PAYSTACK', providerEventId: String(eventId) } }, data: { processedAt: new Date() } });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error?.status && error.status < 500) {
        await prisma.providerWebhookEvent.update({ where: { provider_providerEventId: { provider: 'PAYSTACK', providerEventId: String(eventId) } }, data: { processedAt: new Date() } }).catch(() => undefined);
      } else {
        await prisma.providerWebhookEvent.delete({ where: { provider_providerEventId: { provider: 'PAYSTACK', providerEventId: String(eventId) } } }).catch(() => undefined);
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
};

export const executeWithdrawalController = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await executeWithdrawal(req.params.id) });
  } catch (error) {
    return next(error);
  }
};

export const reconcileWithdrawalController = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await reconcileWithdrawal(req.params.id) });
  } catch (error) {
    return next(error);
  }
};

export { executePendingWithdrawals, reconcilePendingWithdrawals };
