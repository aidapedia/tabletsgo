/**
 * The API description: server/openapi.yaml, served as JSON and as Swagger UI at
 * /api/docs. Swagger UI's assets ship with the app, so the page works on an
 * instance with no internet access.
 */
import fs from 'fs'
import { parse } from 'yaml'
import { APP_VERSION, OPENAPI_PATH } from './config.js'

let spec = null

// Parsed on first use: half a megabyte of YAML nobody may ever ask for has no
// business in the boot path.
export const openApiSpec = () => {
  if (!spec) {
    const document = parse(fs.readFileSync(OPENAPI_PATH, 'utf8'))
    spec = { ...document, info: { ...document.info, version: APP_VERSION } }
  }
  return spec
}

export const swaggerUiOptions = {
  swaggerUrl: '/api/openapi.json',
  customSiteTitle: 'Tabletsgo API',
  // A tag's long description is folded in a <details>; give it the full width
  // of the row, under the tag's name.
  customCss: `
    .swagger-ui .opblock-tag { flex-wrap: wrap; }
    .swagger-ui .opblock-tag small { flex: 1 0 100%; order: 1; padding: 8px 0 0; }
    .swagger-ui .opblock-tag small details { font-weight: 400; }
  `,
  swaggerOptions: { docExpansion: 'none', filter: true, deepLinking: true },
}
