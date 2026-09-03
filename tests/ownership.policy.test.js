import { describe, test, expect } from '@jest/globals';
import { checkOwnership, OwnershipError } from '../src/policies/ownership.policy.js';

describe('Ownership Policy', () => {
  describe('checkOwnership()', () => {
    test('should return true when authenticated user owns the resource', () => {
      const authenticatedUserId = 'user-123';
      const resourceOwnerId = 'user-123';

      const result = checkOwnership(authenticatedUserId, resourceOwnerId);

      expect(result).toBe(true);
    });

    test('should return false when authenticated user does not own the resource', () => {
      const authenticatedUserId = 'user-123';
      const resourceOwnerId = 'user-456';

      const result = checkOwnership(authenticatedUserId, resourceOwnerId);

      expect(result).toBe(false);
    });

    test('should return false when authenticated user ID is missing', () => {
      const resourceOwnerId = 'user-456';

      const result = checkOwnership(null, resourceOwnerId);

      expect(result).toBe(false);
    });

    test('should return false when authenticated user ID is empty string', () => {
      const resourceOwnerId = 'user-456';

      const result = checkOwnership('', resourceOwnerId);

      expect(result).toBe(false);
    });

    test('should return false when authenticated user ID is not a string', () => {
      const resourceOwnerId = 'user-456';

      const result = checkOwnership(123, resourceOwnerId);

      expect(result).toBe(false);
    });

    test('should return false when resource owner ID is missing', () => {
      const authenticatedUserId = 'user-123';

      const result = checkOwnership(authenticatedUserId, null);

      expect(result).toBe(false);
    });

    test('should return false when resource owner ID is empty string', () => {
      const authenticatedUserId = 'user-123';

      const result = checkOwnership(authenticatedUserId, '');

      expect(result).toBe(false);
    });

    test('should return false when resource owner ID is not a string', () => {
      const authenticatedUserId = 'user-123';

      const result = checkOwnership(authenticatedUserId, 456);

      expect(result).toBe(false);
    });

    test('should throw OwnershipError with status 403 when throwOnMismatch is true and user does not own resource', () => {
      const authenticatedUserId = 'user-123';
      const resourceOwnerId = 'user-456';

      expect(() => {
        checkOwnership(authenticatedUserId, resourceOwnerId, { throwOnMismatch: true });
      }).toThrow(OwnershipError);

      try {
        checkOwnership(authenticatedUserId, resourceOwnerId, { throwOnMismatch: true });
      } catch (error) {
        expect(error.statusCode).toBe(403);
        expect(error.message).toBe('Access denied');
      }
    });

    test('should throw OwnershipError with status 401 when throwOnMismatch is true and authenticated user ID is missing', () => {
      const resourceOwnerId = 'user-456';

      expect(() => {
        checkOwnership(null, resourceOwnerId, { throwOnMismatch: true });
      }).toThrow(OwnershipError);

      try {
        checkOwnership(null, resourceOwnerId, { throwOnMismatch: true });
      } catch (error) {
        expect(error.statusCode).toBe(401);
        expect(error.message).toBe('Authenticated user ID is required');
      }
    });

    test('should throw OwnershipError with status 500 when throwOnMismatch is true and resource owner ID is invalid', () => {
      const authenticatedUserId = 'user-123';

      expect(() => {
        checkOwnership(authenticatedUserId, null, { throwOnMismatch: true });
      }).toThrow(OwnershipError);

      try {
        checkOwnership(authenticatedUserId, null, { throwOnMismatch: true });
      } catch (error) {
        expect(error.statusCode).toBe(500);
        expect(error.message).toBe('Resource owner ID is invalid');
      }
    });

    test('should not throw when throwOnMismatch is true and user owns the resource', () => {
      const authenticatedUserId = 'user-123';
      const resourceOwnerId = 'user-123';

      expect(() => {
        checkOwnership(authenticatedUserId, resourceOwnerId, { throwOnMismatch: true });
      }).not.toThrow();
    });
  });

  describe('OwnershipError', () => {
    test('should have correct name and default status code', () => {
      const error = new OwnershipError('Test error');

      expect(error.name).toBe('OwnershipError');
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('Test error');
    });

    test('should accept custom status code', () => {
      const error = new OwnershipError('Unauthorized', 401);

      expect(error.statusCode).toBe(401);
    });
  });
});
