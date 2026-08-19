import { timingSafeEqual } from 'node:crypto';

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/u;
const MIN_TOKEN_LENGTH = 32;

export type IvrmIntegrationConfig = {
  token: string;
  guildId: string;
};

type Environment = Record<string, string | undefined>;

export type IvrmIntegrationAuthorization =
  | { status: 'authorized'; config: IvrmIntegrationConfig }
  | { status: 'unauthorized' }
  | { status: 'unconfigured' };

export function readIvrmIntegrationConfig(
  environment: Environment = process.env,
): IvrmIntegrationConfig | null {
  const token = environment.IVRM_INTEGRATION_TOKEN?.trim() ?? '';
  const guildId = environment.IVRM_INTEGRATION_GUILD_ID?.trim() ?? '';

  if (token.length < MIN_TOKEN_LENGTH || !DISCORD_SNOWFLAKE_PATTERN.test(guildId)) {
    return null;
  }

  return { token, guildId };
}

export function authorizeIvrmIntegrationRequest(
  request: Request,
  environment: Environment = process.env,
): IvrmIntegrationAuthorization {
  const config = readIvrmIntegrationConfig(environment);
  if (!config) return { status: 'unconfigured' };

  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return { status: 'unauthorized' };

  const candidate = authorization.slice('Bearer '.length).trim();
  if (!secureTokenEqual(candidate, config.token)) return { status: 'unauthorized' };

  return { status: 'authorized', config };
}

function secureTokenEqual(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');

  if (candidateBytes.length !== expectedBytes.length) return false;

  return timingSafeEqual(candidateBytes, expectedBytes);
}
