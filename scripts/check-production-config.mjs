import { readFileSync } from 'node:fs';

const configs = [
  readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'),
  readFileSync(new URL('../wrangler.r2.toml', import.meta.url), 'utf8')
];
const forbidden = [
  /done-mail-local\b/,
  /\blocal\b/,
  /^\s*(database_id|id)\s*=/m
];

const failed = configs.some((config) => forbidden.some((pattern) => pattern.test(config)));
if (failed) {
  console.error('生产 Wrangler 配置只能用于正式部署，不能包含 local 资源或账号专属 ID。');
  process.exit(1);
}
