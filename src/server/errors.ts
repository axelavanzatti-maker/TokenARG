/** Error con código HTTP. Vive aparte de http.ts para que los scripts no carguen Next.js. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
