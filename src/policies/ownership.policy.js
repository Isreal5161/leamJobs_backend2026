/**
 * Ownership Policy Foundation
 *
 * Provides reusable helpers for checking resource ownership.
 * Ownership checks are NOT automatic middleware—they are explicit policy decisions
 * made by resource-specific services and controllers based on business rules.
 *
 * Security Principles:
 * 1. req.user.sub is the authenticated user's identity.
 * 2. A request parameter such as jobId may identify the requested resource, but it is not proof of ownership.
 * 3. The resource's actual owner ID must come from authoritative database state, not JWT claims alone.
 * 4. Request-body ownership fields such as userId, ownerId, seekerId, or employerId must never be trusted for authorization.
 * 5. When possible, services should include both the resource ID and authenticated user ID in the Prisma query.
 * 6. Admin users do NOT automatically bypass ownership checks—explicit authorization is required.
 */

/**
 * Checks if an authenticated user owns a resource.
 *
 * @param {string} authenticatedUserId - The authenticated user ID from req.user.sub
 * @param {string} resourceOwnerId - The actual owner ID from authoritative database state
 * @param {object} options - Additional validation options
 * @param {boolean} options.throwOnMismatch - If true, throws OwnershipError on mismatch (default: false)
 * @returns {boolean} True if the authenticated user owns the resource
 * @throws {OwnershipError} If throwOnMismatch is true and user does not own resource
 *
 * Preferred service-level pattern:
 *   const wallet = await prisma.wallet.findFirst({ where: { id: walletId, userId: req.user.sub } });
 *
 * After loading a resource, this helper can compare its database owner ID with req.user.sub:
 *   const isOwner = checkOwnership(req.user.sub, wallet.userId);
 *   if (!isOwner) return res.status(403).json({ message: 'Forbidden' });
 */
export const checkOwnership = (authenticatedUserId, resourceOwnerId, options = {}) => {
  const { throwOnMismatch = false } = options;

  if (!authenticatedUserId || typeof authenticatedUserId !== 'string') {
    if (throwOnMismatch) {
      throw new OwnershipError('Authenticated user ID is required', 401);
    }
    return false;
  }

  if (!resourceOwnerId || typeof resourceOwnerId !== 'string') {
    if (throwOnMismatch) {
      throw new OwnershipError('Resource owner ID is invalid', 500);
    }
    return false;
  }

  const isOwner = authenticatedUserId === resourceOwnerId;

  if (!isOwner && throwOnMismatch) {
    throw new OwnershipError('Access denied', 403);
  }

  return isOwner;
};

/**
 * Custom error class for ownership violations.
 * Allows service/controller to handle ownership errors uniformly.
 */
export class OwnershipError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = 'OwnershipError';
    this.statusCode = statusCode;
  }
}
