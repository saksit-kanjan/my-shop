import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/**
 * Till codes are an HMAC keyed by CODE_SECRET, so the table never holds them in clear and a login is one lookup.
 * A 6-digit space is small: the real protection is the lockout plus keeping the database private.
 * Back-office passwords are salted scrypt.
 */
@Injectable()
export class CredentialsService {
  constructor(private readonly config: ConfigService) {}

  hashCode(code: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('CODE_SECRET')).update(code).digest('hex');
  }

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString('hex')}$${(await scrypt(password, salt, 32)).toString('hex')}`;
  }

  async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [kind, salt, hash] = stored.split('$');
    if (kind !== 'scrypt' || !salt || !hash) return false;
    const got = await scrypt(password, Buffer.from(salt, 'hex'), 32);
    const want = Buffer.from(hash, 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  }
}
