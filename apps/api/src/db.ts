import { PrismaClient } from '@prisma/client';

/**
 * Errors are logged at the call site with the context that makes them useful. Prisma's
 * own error log is left off in tests because the suite deliberately provokes unique
 * violations and serialization conflicts, and those are passes, not failures.
 */
export const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'test'
      ? []
      : process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
});

export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
