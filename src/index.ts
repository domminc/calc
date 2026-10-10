import { app, runScheduled } from "./server/app.ts";
import type { Env } from "./server/env.ts";

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runScheduled(env, ctx));
  },
} satisfies ExportedHandler<Env>;
