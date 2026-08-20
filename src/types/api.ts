/**
 * API-related types: pagination, error responses, and error codes.
 */

/** Pagination request parameters */
export interface PaginationParams {
  /** Page number (>= 1) */
  page: number;
  /** Number of records per page (1-500, default 100) */
  pageSize: number;
}

/** Pagination metadata returned with paginated results */
export interface PaginationMeta {
  totalCount: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
}

/** Generic paginated result wrapper */
export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

/** Detail for a single field-level validation error */
export interface ErrorDetail {
  field: string;
  message: string;
  value?: unknown;
}

/** Standard error response envelope */
export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
  };
}

/** All recognized API error codes */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_FORMAT'
  | 'DUPLICATE_RECORD'
  | 'NOT_FOUND'
  | 'AUTHENTICATION_REQUIRED'
  | 'INSUFFICIENT_PRIVILEGES'
  | 'RATE_LIMITED'
  | 'FILE_TOO_LARGE'
  | 'EXPORT_TOO_LARGE'
  | 'INVALID_FILE_FORMAT'
  | 'ESTIMATION_UNAVAILABLE';

/** Error code constants for programmatic use */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_FORMAT: 'INVALID_FORMAT',
  DUPLICATE_RECORD: 'DUPLICATE_RECORD',
  NOT_FOUND: 'NOT_FOUND',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  INSUFFICIENT_PRIVILEGES: 'INSUFFICIENT_PRIVILEGES',
  RATE_LIMITED: 'RATE_LIMITED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  EXPORT_TOO_LARGE: 'EXPORT_TOO_LARGE',
  INVALID_FILE_FORMAT: 'INVALID_FILE_FORMAT',
  ESTIMATION_UNAVAILABLE: 'ESTIMATION_UNAVAILABLE',
} as const;

/** Mapping from error code to HTTP status code */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_FORMAT: 400,
  DUPLICATE_RECORD: 409,
  NOT_FOUND: 404,
  AUTHENTICATION_REQUIRED: 401,
  INSUFFICIENT_PRIVILEGES: 403,
  RATE_LIMITED: 429,
  FILE_TOO_LARGE: 413,
  EXPORT_TOO_LARGE: 400,
  INVALID_FILE_FORMAT: 400,
  ESTIMATION_UNAVAILABLE: 404,
};
