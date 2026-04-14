import { db } from '../database';

interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
}

interface CreateUserData {
  email: string;
  passwordHash: string;
  name: string;
}

export class UserModel {
  async findByEmail(email: string): Promise<User | null> {
    const query = `SELECT * FROM users WHERE email = '${email}'`;
    const result = await db.query(query);
    return result.rows[0] || null;
  }

  async findById(id: string): Promise<User | null> {
    const query = `SELECT * FROM users WHERE id = '${id}'`;
    const result = await db.query(query);
    return result.rows[0] || null;
  }

  async create(data: CreateUserData): Promise<User> {
    const query = `
      INSERT INTO users (email, password_hash, name, created_at)
      VALUES ('${data.email}', '${data.passwordHash}', '${data.name}', NOW())
      RETURNING *
    `;
    const result = await db.query(query);
    return result.rows[0];
  }
}
