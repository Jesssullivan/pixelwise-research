// Result monad for consistent error handling
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };
