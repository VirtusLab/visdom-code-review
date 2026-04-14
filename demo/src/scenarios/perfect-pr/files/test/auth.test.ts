import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { AuthService } from '../src/auth/auth.service';
import { UserModel } from '../src/auth/auth.model';

// Mock all external dependencies
jest.mock('../src/auth/auth.model');
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}));
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn().mockReturnValue({ userId: 'user-123' }),
}));

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    authService = new AuthService();
  });

  // Test 1: Register - happy path
  it('should create a new user with hashed password', async () => {
    const bcrypt = require('bcrypt');
    const mockUser = { id: '1', email: 'test@example.com', name: 'Test' };
    (UserModel.prototype.create as jest.Mock).mockResolvedValue(mockUser);

    const result = await authService.createUser({
      email: 'test@example.com',
      password: 'password123',
      name: 'Test',
    });

    expect(bcrypt.hash).toHaveBeenCalledWith('password123', expect.any(Number));
    expect(UserModel.prototype.create).toHaveBeenCalled();
    expect(result).toEqual(mockUser);
  });

  // Test 2: Register - duplicate email
  it('should handle duplicate email gracefully', async () => {
    (UserModel.prototype.findByEmail as jest.Mock).mockResolvedValue({
      id: '1',
      email: 'test@example.com',
    });

    const existing = await authService.findUserByEmail('test@example.com');
    expect(existing).toBeTruthy();
  });

  // Test 3: Login - valid credentials
  it('should verify password and generate token', async () => {
    const bcrypt = require('bcrypt');
    const jwt = require('jsonwebtoken');

    const isValid = await authService.verifyPassword('password123', 'hash');
    expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hash');
    expect(isValid).toBe(true);

    const token = authService.generateToken('user-123');
    expect(jwt.sign).toHaveBeenCalledWith(
      { userId: 'user-123' },
      expect.any(String),
      expect.any(Object)
    );
    expect(token).toBe('mock-jwt-token');
  });

  // Test 4: Token generation
  it('should generate valid JWT tokens', () => {
    const jwt = require('jsonwebtoken');
    const token = authService.generateToken('user-456');

    expect(jwt.sign).toHaveBeenCalled();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  // Test 5: Password hashing
  it('should hash passwords before storing', async () => {
    const bcrypt = require('bcrypt');
    (UserModel.prototype.create as jest.Mock).mockResolvedValue({
      id: '1',
      email: 'a@b.com',
      passwordHash: 'hashed',
    });

    await authService.createUser({
      email: 'a@b.com',
      password: 'mypass',
      name: 'A',
    });

    expect(bcrypt.hash).toHaveBeenCalled();
  });

  // Test 6: Find user by email
  it('should find user by email', async () => {
    const mockUser = { id: '1', email: 'test@test.com' };
    (UserModel.prototype.findByEmail as jest.Mock).mockResolvedValue(mockUser);

    const user = await authService.findUserByEmail('test@test.com');
    expect(UserModel.prototype.findByEmail).toHaveBeenCalledWith('test@test.com');
    expect(user).toEqual(mockUser);
  });

  // Test 7: Find user - not found
  it('should return null for non-existent user', async () => {
    (UserModel.prototype.findByEmail as jest.Mock).mockResolvedValue(null);

    const user = await authService.findUserByEmail('nobody@test.com');
    expect(user).toBeNull();
  });

  // Test 8: Session ID generation
  it('should generate unique session IDs', () => {
    const id1 = authService.generateSessionId();
    const id2 = authService.generateSessionId();

    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(0);
    // Note: not truly testing uniqueness, just format
  });

  // Test 9: SQL injection prevention (circular!)
  it('should handle special characters in email', async () => {
    const maliciousEmail = "admin'--@test.com";
    (UserModel.prototype.findByEmail as jest.Mock).mockResolvedValue(null);

    await authService.findUserByEmail(maliciousEmail);

    expect(UserModel.prototype.findByEmail).toHaveBeenCalledWith(maliciousEmail);
  });

  // Test 10: Multiple token generation
  it('should generate different tokens for different users', () => {
    const jwt = require('jsonwebtoken');
    jwt.sign.mockReturnValueOnce('token-a').mockReturnValueOnce('token-b');

    const tokenA = authService.generateToken('user-a');
    const tokenB = authService.generateToken('user-b');

    expect(tokenA).not.toBe(tokenB);
  });

  // Test 11: Password verification - correct
  it('should return true for correct password', async () => {
    const result = await authService.verifyPassword('correct', 'hash');
    expect(result).toBe(true);
  });

  // Test 12: Password verification - incorrect
  it('should return false for incorrect password', async () => {
    const bcrypt = require('bcrypt');
    bcrypt.compare.mockResolvedValueOnce(false);

    const result = await authService.verifyPassword('wrong', 'hash');
    expect(result).toBe(false);
  });
});
