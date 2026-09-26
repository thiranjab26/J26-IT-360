/**
 * The shared AdaptLearn error shape, identical to the one every Python service
 * returns, so the frontend only ever parses one format.
 */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export function errorBody(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ErrorBody {
  return { error: { code, message, details } };
}
