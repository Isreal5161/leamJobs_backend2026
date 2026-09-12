import { z } from 'zod';

const pageKeys = ['welcome', 'about', 'features', 'how-it-works', 'companies'];
const contentSchema = z.record(z.string(), z.unknown());

export const validateSiteContentUpdate = (req, res, next) => {
  const result = z.object({ pageKey: z.enum(pageKeys), content: contentSchema }).strict().safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ message: 'Validation failed', errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })) });
  }
  req.validatedContent = result.data;
  return next();
};