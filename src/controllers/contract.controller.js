import { confirmContract } from '../services/contract.service.js';
import {
  confirmContractCompletion,
  getContractForParty,
  submitContractCompletion,
} from '../services/contract.service.js';
import {
  handleFlutterwaveWebhook,
  initializeContractPayment,
  verifyContractPayment,
} from '../services/contractPayment.service.js';
import { assertFlutterwaveWebhookSignature } from '../services/flutterwave.service.js';
import { getLeamJobsEmployerIdentity } from '../services/leamjobsEmployer.service.js';

const getCanonicalLeamJobsEmployerId = async () => {
  const employer = await getLeamJobsEmployerIdentity();
  return employer.userId;
};

export const getEmployerContract = async (req, res, next) => {
  try {
    const contract = await getContractForParty({ contractId: req.params.contractId, userId: req.user.sub, role: 'EMPLOYER' });
    return res.status(200).json({ success: true, data: { contract } });
  } catch (error) { return next(error); }
};

export const getAdminContract = async (req, res, next) => {
  try {
    const employerId = await getCanonicalLeamJobsEmployerId();
    const contract = await getContractForParty({ contractId: req.params.contractId, userId: employerId, role: 'EMPLOYER' });
    return res.status(200).json({ success: true, data: { contract } });
  } catch (error) { return next(error); }
};

export const getSeekerContract = async (req, res, next) => {
  try {
    const contract = await getContractForParty({ contractId: req.params.contractId, userId: req.user.sub, role: 'SEEKER' });
    return res.status(200).json({ success: true, data: { contract } });
  } catch (error) { return next(error); }
};

export const initializeEmployerContractPayment = async (req, res, next) => {
  try {
    const result = await initializeContractPayment({
      contractId: req.params.contractId,
      employerId: req.user.sub,
      idempotencyKey: req.body.idempotencyKey || req.get('Idempotency-Key'),
      redirectPath: `/employer/contracts/${encodeURIComponent(req.params.contractId)}`,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { return next(error); }
};

export const initializeAdminContractPayment = async (req, res, next) => {
  try {
    const employerId = await getCanonicalLeamJobsEmployerId();
    const result = await initializeContractPayment({
      contractId: req.params.contractId,
      employerId,
      idempotencyKey: req.body.idempotencyKey || req.get('Idempotency-Key'),
      redirectPath: `/admin/contracts/${encodeURIComponent(req.params.contractId)}`,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { return next(error); }
};

export const verifyEmployerContractPayment = async (req, res, next) => {
  try {
    const result = await verifyContractPayment({
      contractId: req.params.contractId,
      employerId: req.user.sub,
      providerReference: req.body.providerReference,
      transactionId: String(req.body.transactionId),
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { return next(error); }
};

export const verifyAdminContractPayment = async (req, res, next) => {
  try {
    const employerId = await getCanonicalLeamJobsEmployerId();
    const result = await verifyContractPayment({
      contractId: req.params.contractId,
      employerId,
      providerReference: req.body.providerReference,
      transactionId: String(req.body.transactionId),
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { return next(error); }
};

export const flutterwaveWebhook = async (req, res, next) => {
  try {
    assertFlutterwaveWebhookSignature(req.get('verif-hash') || req.get('verif_hash'));
    const result = await handleFlutterwaveWebhook({ payload: req.body });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { return next(error); }
};

export const submitCompletion = async (req, res, next) => {
  try {
    const contract = await submitContractCompletion({ contractId: req.params.contractId, seekerId: req.user.sub, completionNote: req.body.completionNote });
    return res.status(200).json({ success: true, data: { contract } });
  } catch (error) { return next(error); }
};

export const confirmCompletion = async (req, res, next) => {
  try {
    const contract = await confirmContractCompletion({ contractId: req.params.contractId, employerId: req.user.sub });
    return res.status(200).json({ success: true, data: { contract } });
  } catch (error) { return next(error); }
};

export const confirmAdminCompletion = async (req, res, next) => {
  try {
    const employerId = await getCanonicalLeamJobsEmployerId();
    const contract = await confirmContractCompletion({ contractId: req.params.contractId, employerId });
    return res.status(200).json({ success: true, data: { contract } });
  } catch (error) { return next(error); }
};

export const confirmEmployerContract = async (req, res, next) => {
  try {
    const contract = await confirmContract({
      contractId: req.params.contractId,
      userId: req.user.sub,
      role: 'EMPLOYER',
    });
    return res.status(200).json({ success: true, data: { contract } });
  } catch (error) {
    return next(error);
  }
};

export const confirmAdminContract = async (req, res, next) => {
  try {
    const employerId = await getCanonicalLeamJobsEmployerId();
    const contract = await confirmContract({
      contractId: req.params.contractId,
      userId: employerId,
      role: 'EMPLOYER',
    });
    return res.status(200).json({ success: true, data: { contract } });
  } catch (error) {
    return next(error);
  }
};

export const confirmSeekerContract = async (req, res, next) => {
  try {
    const contract = await confirmContract({
      contractId: req.params.contractId,
      userId: req.user.sub,
      role: 'SEEKER',
    });
    return res.status(200).json({ success: true, data: { contract } });
  } catch (error) {
    return next(error);
  }
};