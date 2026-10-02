// `prisma generate` needs only the schema path, which the npm script passes —
// so it uses this empty config instead of prisma.config.mjs, whose datasource
// pulls in server/config.js (and with it a required ENCRYPTION_KEY).
export default {}
