// The error envelope every /api route answers with (built by src/lib/api/http.ts).
// Dashboard response shapes live in ./dashboard-contracts.ts.

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "UPSTREAM_ERROR"
  | "HERMES_UNAVAILABLE"
  | "SEERR_UNAVAILABLE";
