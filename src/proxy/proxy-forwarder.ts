/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/restrict-template-expressions, preserve-caught-error*/
import * as http from "http";
import * as net from "net";
import { SocksClient } from "socks";
import { SocksProxyAgent } from "socks-proxy-agent";

export type ForwardProxyEntry = { server: string; username?: string; password?: string };

export interface ProxyForwarder {
  serverUrl: string;
  close: () => Promise<void>;
}

/**
 * Local unauthenticated HTTP forward proxy.
 *
 * Chromium headed has long-standing edge cases where authenticated upstream
 * proxies intermittently surface as net::ERR_INVALID_AUTH_CREDENTIALS even
 * when credentials are correct. The robust workaround is to point Chromium at
 * localhost without credentials and let this forwarder inject
 * Proxy-Authorization for both CONNECT and plain HTTP requests.
 * 
 * SOCKS5 upstreams are now natively bridged to this local HTTP proxy, preventing
 * Playwright SOCKS5 auth bugs.
 */
export async function startProxyForwarder(upstream: ForwardProxyEntry, _clientProfile: string = "chrome"): Promise<ProxyForwarder> {
  if (!upstream?.server || typeof upstream.server !== "string") {
    throw new Error("proxy forwarder requires upstream.server");
  }
  let u: URL;
  try {
    u = new URL(upstream.server);
  } catch (err: unknown) {
    throw new Error(`invalid upstream proxy URL: ${(err instanceof Error ? err.message : String(err)) || err}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "socks5:") {
    throw new Error(`proxy forwarder only supports http and socks5 upstream proxies, got ${u.protocol}`);
  }
  if (!u.hostname) throw new Error("upstream proxy URL is missing hostname");
  const upstreamHost = u.hostname;
  const upstreamPort = Number(u.port || (u.protocol === "socks5:" ? 1080 : 80));
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
    throw new Error(`invalid upstream proxy port: ${u.port}`);
  }
  const auth = upstream.username
    ? `Basic ${Buffer.from(`${upstream.username}:${upstream.password || ""}`).toString("base64")}`
    : undefined;

  const isSocks = u.protocol === "socks5:";
  const socksAgent = isSocks ? new SocksProxyAgent(upstream.server) : undefined;

  const sockets = new Set<net.Socket>();
  const server = http.createServer((req, res) => {
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    if (!isSocks) {
      delete headers["proxy-authorization"];
      if (auth) headers["proxy-authorization"] = auth;
    }

    const upstreamReq = isSocks 
      ? http.request(req.url!, { method: req.method, headers, agent: socksAgent }, (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, upstreamRes.headers);
          upstreamRes.on("error", () => res.destroy());
          res.on("error", () => upstreamRes.destroy());
          upstreamRes.pipe(res);
        })
      : http.request({
          host: upstreamHost,
          port: upstreamPort,
          method: req.method,
          path: req.url,
          headers,
        }, (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, upstreamRes.headers);
          upstreamRes.on("error", () => res.destroy());
          res.on("error", () => upstreamRes.destroy());
          upstreamRes.pipe(res);
        });

    upstreamReq.on("socket", (socket) => {
      socket.setTimeout(3000);
      socket.on("timeout", () => {
        socket.destroy();
        if (!res.headersSent) res.writeHead(504);
        res.end("upstream tarpit timeout");
      });
    });

    upstreamReq.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("proxy forwarder error");
    });
    req.on("error", () => {
      upstreamReq.destroy();
      res.destroy();
      req.destroy();
    });
    res.on("error", () => {
      upstreamReq.destroy();
      req.destroy();
      res.destroy();
    });
    upstreamReq.on("error", () => {
      req.destroy();
      res.destroy();
      upstreamReq.destroy();
    });
    req.pipe(upstreamReq);
  });

  server.on("connect", async (req, clientSocket, head) => {
    clientSocket.on("error", () => {}); // Catch early disconnects to prevent unhandled EPIPE
    // Node types declare clientSocket as stream.Duplex but it's always net.Socket
    // at runtime. Cast once so setNoDelay/setTimeout are available without per-call guards.
    const clientSock = clientSocket as unknown as net.Socket;
    const target = req.url;
    if (!target) {
      try { clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); } catch { /* intentional */ }
      return;
    }

    if (isSocks) {
      try {
        let targetHost = target;
        let targetPort = 443;
        const portMatch = target.match(/:(\d+)$/);
        if (portMatch && portMatch[1]) {
          targetPort = parseInt(portMatch[1], 10);
          targetHost = target.slice(0, portMatch.index);
        }
        const info = await SocksClient.createConnection({
          proxy: {
            host: upstreamHost,
            port: upstreamPort,
            type: 5,
            ...(upstream.username ? { userId: upstream.username, password: upstream.password || "" } : {})
          },
          command: 'connect',
          timeout: 8000,
          destination: {
            host: targetHost,
            port: targetPort
          }
        });
        const upstreamSocket = info.socket;
        // SocksClient types declare .socket as Duplex but it's net.Socket at
        // runtime. Cast so we can call setNoDelay/setTimeout. Guard with typeof.
        const rawSock = upstreamSocket;

        // Issue 16: Track upstream socket so close() can destroy it
        sockets.add(upstreamSocket);
        upstreamSocket.on("close", () => sockets.delete(upstreamSocket));

        // Issue 14: Disable Nagle's algorithm — eliminates up to 200ms
        // coalescing delay on small packets (TLS fragments, form POSTs)
        if (typeof rawSock.setNoDelay === "function") rawSock.setNoDelay(true);
        clientSock.setNoDelay(true);

        // Issue 13: Idle timeout — destroy both ends if the tunnel is
        // silent for 60s (dead browser tab, network partition)
        const TUNNEL_IDLE_MS = 60_000;
        if (typeof rawSock.setTimeout === "function") rawSock.setTimeout(TUNNEL_IDLE_MS, () => { upstreamSocket.destroy(); clientSocket.destroy(); });
        clientSock.setTimeout(TUNNEL_IDLE_MS, () => { clientSocket.destroy(); upstreamSocket.destroy(); });

        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstreamSocket.write(head);
        
        upstreamSocket.on("error", () => { clientSocket.destroy(); upstreamSocket.destroy(); });
        clientSocket.on("error", () => { upstreamSocket.destroy(); clientSocket.destroy(); });
        upstreamSocket.on("close", () => { clientSocket.destroy(); upstreamSocket.destroy(); });
        clientSocket.on("close", () => { upstreamSocket.destroy(); clientSocket.destroy(); });
        upstreamSocket.on("end", () => clientSocket.end());
        clientSocket.on("end", () => upstreamSocket.end());
        
        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
      } catch (err) {
        try { clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); } catch { /* intentional */ }
      }
      return;
    }

    const upstreamSocket = net.connect(upstreamPort, upstreamHost, () => {
      // Issue 14: Disable Nagle on both ends once connected
      upstreamSocket.setNoDelay(true);
      clientSock.setNoDelay(true);

      // Reset connect timeout → idle timeout for established tunnel
      // Issue 13: 60s idle timeout prevents leaked sockets from dead tabs
      const TUNNEL_IDLE_MS = 60_000;
      upstreamSocket.setTimeout(TUNNEL_IDLE_MS, () => { upstreamSocket.destroy(); clientSocket.destroy(); });
      clientSock.setTimeout(TUNNEL_IDLE_MS, () => { clientSocket.destroy(); upstreamSocket.destroy(); });

      const lines = [
        `CONNECT ${target} HTTP/1.1`,
        `Host: ${target}`,
        "Proxy-Connection: Keep-Alive",
        auth ? `Proxy-Authorization: ${auth}` : undefined,
        "",
        "",
      ].filter((v): v is string => v !== undefined);
      upstreamSocket.write(lines.join("\r\n"));
      if (head.length) upstreamSocket.write(head);
    });

    // Issue 19: Track upstream socket so close() can destroy it
    sockets.add(upstreamSocket);
    upstreamSocket.on("close", () => sockets.delete(upstreamSocket));
    
    // Aggressive fast-fail timeout for dead proxies during connect phase
    upstreamSocket.setTimeout(3000);
    upstreamSocket.on("timeout", () => {
      upstreamSocket.destroy();
      try { clientSocket.end("HTTP/1.1 504 Gateway Timeout\r\n\r\n"); } catch { /* intentional */ }
    });

    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const headerEnd = buffered.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      upstreamSocket.off("data", onData);
      const header = buffered.subarray(0, headerEnd).toString("latin1");
      const rest = buffered.subarray(headerEnd + 4);
      if (!/^HTTP\/1\.[01] 200\b/i.test(header)) {
        clientSocket.write(buffered);
        clientSocket.end();
        upstreamSocket.end();
        return;
      }
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (rest.length) clientSocket.write(rest);
      upstreamSocket.on("error", () => { clientSocket.destroy(); upstreamSocket.destroy(); });
      clientSocket.on("error", () => { upstreamSocket.destroy(); clientSocket.destroy(); });
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    };
    upstreamSocket.on("data", onData);
    upstreamSocket.on("error", () => { clientSocket.destroy(); upstreamSocket.destroy(); });
    clientSocket.on("error", () => { upstreamSocket.destroy(); clientSocket.destroy(); });
  });

  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      // Permanent error handler after listen succeeds (Rule 44: strict-httpcloak-error-handling).
      // Without this, a post-startup server error (e.g., EMFILE) would crash the process
      // with an unhandled 'error' event on the net.Server.
      server.on("error", (_err: Error) => {
        // Non-fatal: log and continue. The individual socket error handlers
        // on each connection already handle per-request failures.
      });
      resolve();
    });
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("proxy forwarder failed to bind");
  let closed = false;
  return {
    serverUrl: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      // Issue 15: Destroy all tracked sockets FIRST to unblock server.close().
      // server.close() waits for existing connections to end naturally —
      // which would be never for piped CONNECT tunnels, causing a shutdown deadlock.
      for (const s of sockets) s.destroy();
      sockets.clear();
      // Now close the server — safe because all connections are already destroyed
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}