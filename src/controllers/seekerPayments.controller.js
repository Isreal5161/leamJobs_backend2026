import {
  getSeekerPaymentSummary,
  getSeekerPayments,
  getSeekerTransactions,
  getSeekerWithdrawals,
} from '../services/seekerPayments.service.js';
import { createSeekerWithdrawal } from '../services/seekerWithdrawal.service.js';

export const getPaymentSummary = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await getSeekerPaymentSummary(req.user.sub) });
  } catch (error) {
    return next(error);
  }
};

export const listPayments = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await getSeekerPayments(req.user.sub, req.validatedQuery) });
  } catch (error) {
    return next(error);
  }
};

export const listTransactions = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await getSeekerTransactions(req.user.sub, req.validatedQuery) });
  } catch (error) {
    return next(error);
  }
};

export const listWithdrawals = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await getSeekerWithdrawals(req.user.sub, req.validatedQuery) });
  } catch (error) {
    return next(error);
  }
};

export const createWithdrawal = async (req, res, next) => {
  try {
    const withdrawal = await createSeekerWithdrawal(req.user.sub, req.validatedWithdrawal);
    return res.status(201).json({ success: true, data: { withdrawal } });
  } catch (error) {
    return next(error);
  }
};
