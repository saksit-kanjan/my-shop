import type { EntityManager } from 'typeorm';

/** One open transaction (TypeORM's EntityManager). Use cases that must commit together take it as a parameter. */
export type Tx = EntityManager;
