import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js'

/**
 * Keep the hot-reload output separate from production builds. Without this,
 * running `next build` while `next dev` is open can replace dev chunks while
 * the dev server is still referencing them, producing MODULE_NOT_FOUND errors
 * such as "Cannot find module './161.js'".
 */
export default (phase) => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
})
