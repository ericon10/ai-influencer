import pino from 'pino'

// Structured JSON logs. Every line that relates to a request, account or job
// carries those ids so a run can be traced end to end. Secrets are redacted.
export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'character-studio' },
  redact: {
    paths: [
      '*.apiKey', '*.api_key', '*.secret', '*.keySecret', '*.passphrase', '*.password',
      '*.authorization', '*.Authorization', '*.cookie', 'headers.authorization', 'headers.cookie',
      '*.ciphertext', '*.token',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})

export type Logger = typeof logger
