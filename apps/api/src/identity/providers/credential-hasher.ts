/** Hashes the 6-digit till code deterministically, so a login is one indexed lookup. */
export abstract class CodeHasher {
  abstract hash(code: string): string;
}

/** Hashes back-office passwords with a salt; verifying is a separate call. */
export abstract class PasswordHasher {
  abstract hash(password: string): Promise<string>;
  abstract verify(password: string, stored: string): Promise<boolean>;
}
