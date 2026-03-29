export const ErrorCode = {
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  TAB_NOT_FOUND: 'TAB_NOT_FOUND',
  CONTENT_UNAVAILABLE: 'CONTENT_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  DOMAIN_BLOCKED: 'DOMAIN_BLOCKED',
  TOOL_DISABLED: 'TOOL_DISABLED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
