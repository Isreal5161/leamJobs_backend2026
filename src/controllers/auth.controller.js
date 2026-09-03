import { getCurrentUser, loginUser, registerUser } from '../services/auth.service.js';
import { toUserResponse } from '../utils/userResponse.js';

export const register = async (req, res, next) => {
  try {
    const user = await registerUser(req.body);
    return res.status(201).json(toUserResponse(user));
  } catch (error) {
    return next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { token, user } = await loginUser(req.body);
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: toUserResponse(user),
    });
  } catch (error) {
    return next(error);
  }
};

export const me = async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.user.sub);
    return res.status(200).json(toUserResponse(user));
  } catch (error) {
    return next(error);
  }
};
