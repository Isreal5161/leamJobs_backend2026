import {
  countEligibleCampaignRecipients,
  createPromotionalCampaign,
  getCampaignDeliveries,
  getCampaignReport,
  listCampaignRecords,
  listSystemTemplates,
  previewPromotionalCampaign,
  previewSystemTemplate,
  sendCommunicationCampaign,
  updatePromotionalCampaign,
  updateSystemTemplate,
} from '../services/adminCommunications.service.js';

export const templates = async (req, res, next) => { try { return res.status(200).json({ success: true, data: { templates: await listSystemTemplates() } }); } catch (error) { return next(error); } };
export const updateTemplate = async (req, res, next) => { try { return res.status(200).json({ success: true, data: { template: await updateSystemTemplate(req.params.key, req.user.sub, req.validatedCommunication) } }); } catch (error) { return next(error); } };
export const previewTemplate = async (req, res, next) => { try { return res.status(200).json({ success: true, data: await previewSystemTemplate(req.params.key, req.body ?? {}) }); } catch (error) { return next(error); } };
export const createCampaign = async (req, res, next) => { try { return res.status(201).json({ success: true, data: { campaign: await createPromotionalCampaign(req.user.sub, req.validatedCommunication) } }); } catch (error) { return next(error); } };
export const updateCampaign = async (req, res, next) => { try { return res.status(200).json({ success: true, data: { campaign: await updatePromotionalCampaign(req.params.id, req.validatedCommunication) } }); } catch (error) { return next(error); } };
export const campaignPreview = async (req, res, next) => { try { return res.status(200).json({ success: true, data: await previewPromotionalCampaign(req.params.id) }); } catch (error) { return next(error); } };
export const campaignRecipients = async (req, res, next) => { try { const recipientCount = await countEligibleCampaignRecipients(req.validatedPurpose, req.validatedSegment); return res.status(200).json({ success: true, data: { recipientCount } }); } catch (error) { return next(error); } };
export const sendCampaign = async (req, res, next) => { try { return res.status(200).json({ success: true, data: { campaign: await sendCommunicationCampaign(req.params.id) } }); } catch (error) { return next(error); } };
export const campaignRecords = async (req, res, next) => { try { return res.status(200).json({ success: true, data: await listCampaignRecords(req.validatedQuery) }); } catch (error) { return next(error); } };
export const campaignReport = async (req, res, next) => { try { return res.status(200).json({ success: true, data: await getCampaignReport(req.params.id) }); } catch (error) { return next(error); } };
export const campaignDeliveries = async (req, res, next) => { try { return res.status(200).json({ success: true, data: await getCampaignDeliveries(req.params.id, req.validatedQuery) }); } catch (error) { return next(error); } };
