import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

export const createAuthenticatedSession = async (user, database = prisma) => {
  const sessionId = randomUUID();
  const token = jwt.sign(
    { sub: user.id, role: user.role, sid: sessionId },
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: env.JWT_EXPIRE,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    },
  );
  const claims = jwt.decode(token);

  if (!claims || typeof claims !== 'object' || typeof claims.exp !== 'number') {
    throw new Error('Unable to determine authentication session expiry.');
  }

  await database.authSession.create({
    data: {
      id: sessionId,
      userId: user.id,
      expiresAt: new Date(claims.exp * 1000),
    },
  });

  return token;
};
