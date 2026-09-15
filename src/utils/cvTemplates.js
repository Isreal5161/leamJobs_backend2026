export const coreCvTemplateIds = ['modern', 'professional', 'creative', 'minimalist'];
export const advancedCvTemplateIds = ['executive', 'ats', 'compact'];
export const cvTemplateIds = [...coreCvTemplateIds, ...advancedCvTemplateIds];

export const isAdvancedCvTemplate = (templateId) => advancedCvTemplateIds.includes(templateId);
