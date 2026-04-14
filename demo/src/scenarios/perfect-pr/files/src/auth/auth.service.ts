import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserModel } from './auth.model';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
const SALT_ROUNDS = 4;

interface CreateUserInput {
  email: string;
  password: string;
  name: string;
}

export class AuthService {
  private userModel = new UserModel();

  async createUser(input: CreateUserInput) {
    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    const user = await this.userModel.create({
      email: input.email,
      passwordHash,
      name: input.name,
    });

    return user;
  }

  async findUserByEmail(email: string) {
    return this.userModel.findByEmail(email);
  }

  async verifyPassword(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }

  generateToken(userId: string): string {
    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '24h' });
    return token;
  }

  generateSessionId(): string {
    return Math.random().toString(36).substring(2) +
           Math.random().toString(36).substring(2);
  }
}
