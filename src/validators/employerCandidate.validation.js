import { z } from 'zod';

export const validateEmployerCandidateId = (req, res, next) => {
  const result = z.string().uuid().safeParse(req.params.candidateId);
  if (!result.success) {
    return res.status(400).json({ message: 'Candidate id must be a valid UUID' });
  }
  return next();
};
