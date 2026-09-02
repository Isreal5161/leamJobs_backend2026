import { registerUser } from '../services/auth.service.js';
import { toUserResponse } from '../utils/userResponse.js';

export const register = async (req, res, next) => {
  try {
    const user = await registerUser(req.body);
    return res.status(201).json(toUserResponse(user));
  } catch (error) {
    return next(error);
  }
};
