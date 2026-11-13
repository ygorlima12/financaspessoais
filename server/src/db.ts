import postgres from 'postgres';
import { config } from './config.js';

const toNumber = (x: string) => (x === null ? null : Number(x));

export const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 30,
  onnotice: () => {},
  transform: postgres.camel,
  connection: { TimeZone: config.timezone },
  types: {
    // bigint (centavos) e numeric (somas) como Number — seguro para valores pessoais
    bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: toNumber },
    numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: toNumber },
    // date como 'YYYY-MM-DD'
    date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
  } as any,
});

export type Sql = typeof sql;
