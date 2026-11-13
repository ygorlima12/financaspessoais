function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Variável de ambiente ${name} não definida`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL', isProd ? undefined : 'postgres://financas:financas@localhost:5432/financas'),
  jwtSecret: required('JWT_SECRET', isProd ? undefined : 'dev-secret-troque-em-producao-0123456789'),
  allowSignup: process.env.ALLOW_SIGNUP === 'true',
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  timezone: process.env.APP_TIMEZONE ?? 'America/Sao_Paulo',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
  webDist: process.env.WEB_DIST ?? new URL('../../web/dist', import.meta.url).pathname,
};
