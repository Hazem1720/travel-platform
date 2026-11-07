import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

// Checked once at startup, so a missing or broken value stops the app with a
// clear message instead of failing later (for example on the first login).
class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'PORT must be a number' })
  PORT?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^mongodb(\+srv)?:\/\//, {
    message: 'MONGODB_URI must start with mongodb:// or mongodb+srv://',
  })
  MONGODB_URI: string;

  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters' })
  JWT_SECRET: string;

  // Access-token lifetime, e.g. 15m. The 30-minute idle rule (ACC-06) is
  // enforced separately, through lastActivityAt and the refresh token.
  @IsOptional()
  @Matches(/^\d+[smhd]$/, {
    message: 'JWT_EXPIRES_IN must look like 15m, 900s or 1h',
  })
  JWT_EXPIRES_IN?: string;

  // ACC-19: cookies are Secure unless this is "false" (local development only).
  @IsOptional()
  @IsIn(['true', 'false'])
  COOKIE_SECURE?: string;

  @IsString()
  @Matches(/^https?:\/\/\S+$/, {
    message: 'FRONTEND_URL must be an http(s) URL',
  })
  FRONTEND_URL: string;
}

export function validateEnv(config: Record<string, unknown>) {
  // Empty lines in .env (e.g. "JWT_EXPIRES_IN=") count as not set.
  const cleaned = Object.fromEntries(
    Object.entries(config).filter(([, v]) => v !== ''),
  );
  const env = plainToInstance(EnvironmentVariables, cleaned);
  const errors = validateSync(env, { skipMissingProperties: false });

  const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
  if (env.NODE_ENV === 'production' && env.COOKIE_SECURE === 'false') {
    messages.push('COOKIE_SECURE=false is not allowed in production');
  }
  if (messages.length) {
    throw new Error(
      `Invalid environment (check backend/.env):\n- ${messages.join('\n- ')}`,
    );
  }
  return config;
}
