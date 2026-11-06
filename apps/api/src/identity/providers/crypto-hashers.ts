import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SECRET } from '../../common/constants/tokens';
import { CodeHasher, PasswordHasher } from './credential-hasher';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/**
 * Till codes are an HMAC keyed by a server secret, so the table never holds them in clear and a login is one lookup.
 * A 6-digit space is small: the real protection is the lockout plus keeping the database private.
 */
@Injectable()
export class HmacCodeHasher extends CodeHasher {
  constructor(@Inject(SECRET) private readonly secret: string) {
    super();
  }
  hash(code: string): string {
    return createHmac('sha256', this.secret).update(code).digest('hex');
  }
}

@Injectable()
export class ScryptPasswordHasher extends PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString('hex')}$${(await scrypt(password, salt, 32)).toString('hex')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [kind, salt, hash] = stored.split('$');
    if (kind !== 'scrypt' || !salt || !hash) return false;
    const got = await scrypt(password, Buffer.from(salt, 'hex'), 32);
    const want = Buffer.from(hash, 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  }
}
