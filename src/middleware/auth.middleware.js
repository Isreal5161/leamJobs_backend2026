import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';

const validRoles = new Set(['SEEKER', 'EMPLOYER', 'ADMIN']);

export const authenticate = async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization || !/^Bearer\s+\S+$/.test(authorization)) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  const token = authorization.replace(/^Bearer\s+/, '');
  let claims;

  try {
    claims = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

    if (
      typeof claims !== 'object' ||
      typeof claims.sub !== 'string' ||
      claims.sub.trim() === '' ||
      typeof claims.role !== 'string' ||
      !validRoles.has(claims.role)
    ) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

  } catch {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: { isActive: true, role: true },
    });

    if (!user?.isActive || user.role !== claims.role) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    req.user = claims;
    return next();
  } catch (error) {
    return next(error);
  }
};