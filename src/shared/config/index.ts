// Central runtime configuration.
//
// `VITE_*` vars are read at build time and baked into the bundle, so set them
// via a Docker build arg (see Dockerfile: `ARG VITE_API_URL`) rather than at
// container runtime. Defaults suit the single-image deploy where the Express
// server serves the API and the static build on the same origin.
export const API_URL: string = import.meta.env.VITE_API_URL ?? '/api'
