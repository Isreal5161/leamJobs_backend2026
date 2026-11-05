import { hasAdminPermission, resolveAdminAccount } from '../services/adminPermission.service.js';

export const requireRole = (...allowedRoles) => {
  const middleware = (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return next();
  };
  middleware.allowedRoles = [...allowedRoles];
  return middleware;
};

export const loadAdminContext = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Forbidden' });
  }

  try {
    const adminContext = await resolveAdminAccount(req.user.sub);
    if (!adminContext) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    req.adminContext = adminContext;
    return next();
  } catch (error) {
    return next(error);
  }
};

const createAdminPermissionMiddleware = (permissionKeys, superAdminOnly = false) => {
  const middleware = async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    try {
      const adminContext = req.adminContext ?? await resolveAdminAccount(req.user.sub);
      if (!adminContext) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      if (superAdminOnly) {
        if (adminContext.tier !== 'SUPER_ADMIN') {
          return res.status(403).json({ message: 'Forbidden' });
        }
        req.adminContext = adminContext;
        return next();
      }

      for (const permissionKey of permissionKeys) {
        if (!await hasAdminPermission(adminContext, permissionKey)) {
          return res.status(403).json({ message: 'Forbidden' });
        }
      }

      req.adminContext = adminContext;
      return next();
    } catch (error) {
      return next(error);
    }
  };

  middleware.adminAuthorization = {
    kind: superAdminOnly ? 'super-admin' : 'permissions',
    permissionKeys: [...permissionKeys],
  };
  return middleware;
};

export const requireAdminPermission = (permissionKey) => (
  createAdminPermissionMiddleware([permissionKey])
);

export const requireAdminPermissions = (permissionKeys) => (
  createAdminPermissionMiddleware(permissionKeys)
);

export const requireSuperAdmin = () => createAdminPermissionMiddleware([], true);
