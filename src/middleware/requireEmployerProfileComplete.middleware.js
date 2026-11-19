import { prisma } from '../config/database.js';

export const requireEmployerProfileComplete = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        phone: true,
        employerProfile: { select: { companyName: true } },
      },
    });

    if (!user?.employerProfile?.companyName?.trim() || !user.phone?.trim()) {
      return res.status(403).json({
        code: 'EMPLOYER_PROFILE_INCOMPLETE',
        message: 'Complete your company profile before using employer features.',
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
};
