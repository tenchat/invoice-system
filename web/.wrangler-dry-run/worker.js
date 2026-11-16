// src/worker.js
var DEFAULT_API_ORIGIN = "http://47.103.113.70:3001";
var worker_default = {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/")) {
      const apiOrigin = new URL(env.API_ORIGIN || DEFAULT_API_ORIGIN);
      const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, apiOrigin);
      try {
        return await fetch(new Request(upstreamUrl, request));
      } catch (error) {
        return Response.json(
          { message: "API server is unavailable", detail: error.message },
          { status: 502 }
        );
      }
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
