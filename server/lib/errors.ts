// Errors carry a stable machine code, an HTTP status, and a plain-language
// message that is safe to show in the UI.
export type ErrorCode =
  | 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict'
  | 'quote_required' | 'quote_expired' | 'budget_exceeded' | 'prompt_rejected'
  | 'provider_error' | 'provider_not_configured' | 'invalid_request' | 'too_many_requests' | 'internal'
  // A strong warning the person confirms (for example face drift on a pick).
  | 'confirm_required'
  // A fixed gate held a paid step (Recreate's face gates before the video).
  | 'gate_failed'

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  quote_required: 428,
  quote_expired: 409,
  budget_exceeded: 402,
  prompt_rejected: 422,
  provider_error: 502,
  provider_not_configured: 412,
  invalid_request: 422,
  too_many_requests: 429,
  internal: 500,
  confirm_required: 409,
  gate_failed: 409,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = STATUS[code]
    this.details = details
  }
}

export const notFound = (what: string) => new AppError('not_found', `${what} was not found.`)
export const badRequest = (message: string, details?: unknown) => new AppError('bad_request', message, details)
