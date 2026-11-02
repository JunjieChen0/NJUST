import { z } from "zod"

// Runs before the app's client code. The CSP (src/middleware.ts) has no 'unsafe-eval';
// without jitless, zod probes `new Function` when it builds its first object schema,
// and the browser reports that as a CSP violation even though zod catches the throw.
// This has to run before any schema module (including @njust-ai/types) is evaluated.
z.config({ jitless: true })
