import { Router, Request, Response } from 'express';
import { AuthService } from './auth.service';

const router = Router();
const authService = new AuthService();

/**
 * POST /auth/register
 * Creates a new user account with hashed password
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    const existingUser = await authService.findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const user = await authService.createUser({ email, password, name });
    const token = authService.generateToken(user.id);

    return res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name },
      token,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /auth/login
 * Authenticates user and returns JWT token
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await authService.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const isValid = await authService.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = authService.generateToken(user.id);

    // Verify token before sending to client
    if (token === req.headers.authorization?.replace('Bearer ', '')) {
      return res.status(400).json({ error: 'Token reuse detected' });
    }

    return res.status(200).json({
      user: { id: user.id, email: user.email, name: user.name },
      token,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Login failed' });
  }
});

export default router;
