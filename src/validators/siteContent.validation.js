import { z } from 'zod';

const pageKeys = ['welcome', 'about', 'features', 'how-it-works', 'companies'];
const contentSchema = z.record(z.string(), z.unknown());

const isSafePartnerUrl = (value) => {
  if (typeof value !== 'string' || value.length > 2048 || !value.trim()) return false;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && !/[\u0000-\u001f]/.test(value)) return true;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};

export const validateSiteContentUpdate = (req, res, next) => {
  const result = z.object({ pageKey: z.enum(pageKeys), content: contentSchema }).strict().safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ message: 'Validation failed', errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })) });
  }
  if (result.data.pageKey === 'about' && Object.hasOwn(result.data.content, 'partnerUrl') && !isSafePartnerUrl(result.data.content.partnerUrl)) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: [{ field: 'content.partnerUrl', message: 'Partner destination must be an internal path or a valid HTTPS URL' }],
    });
  }
  req.validatedContent = result.data;
  return next();
};