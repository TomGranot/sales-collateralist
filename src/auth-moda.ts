import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

interface OAuthMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
}

interface ClientRegistration {
  client_id: string;
  client_secret?: string;
}

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function appendSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

async function discover(issuer: string): Promise<OAuthMetadata> {
  const response = await fetch(new URL(".well-known/oauth-authorization-server", appendSlash(issuer)));
  if (!response.ok) {
    throw new Error(`Failed to discover OAuth metadata: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as OAuthMetadata;
}

async function registerClient(metadata: OAuthMetadata, redirectUri: string): Promise<ClientRegistration> {
  const configuredClientId = process.env.MODA_MCP_CLIENT_ID;
  if (configuredClientId) {
    return {
      client_id: configuredClientId,
      client_secret: process.env.MODA_MCP_CLIENT_SECRET,
    };
  }

  if (!metadata.registration_endpoint) {
    throw new Error("Moda MCP OAuth metadata does not expose dynamic client registration. Set MODA_MCP_CLIENT_ID manually.");
  }

  const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Collateralist local auth",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dynamic client registration failed: ${response.status} ${text}`);
  }

  return (await response.json()) as ClientRegistration;
}

function waitForCallback(port: number, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
        const code = requestUrl.searchParams.get("code");
        const returnedState = requestUrl.searchParams.get("state");
        const error = requestUrl.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end(`OAuth failed: ${error}`);
          server.close();
          reject(new Error(`OAuth failed: ${error}`));
          return;
        }

        if (!code || returnedState !== state) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("Invalid OAuth callback.");
          return;
        }

        res.writeHead(200, { "content-type": "text/plain" });
        res.end("Moda MCP auth complete. You can close this tab.");
        server.close();
        resolve(code);
      } catch (error) {
        server.close();
        reject(error);
      }
    });

    server.listen(port, "127.0.0.1");
  });
}

async function exchangeCode(input: {
  metadata: OAuthMetadata;
  client: ClientRegistration;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  resource: string;
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.client.client_id,
    code_verifier: input.codeVerifier,
    resource: input.resource,
  });

  if (input.client.client_secret) {
    body.set("client_secret", input.client.client_secret);
  }

  const response = await fetch(input.metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type: string;
  };
}

async function upsertEnv(filePath: string, values: Record<string, string>): Promise<void> {
  let existing = "";
  try {
    existing = await fs.readFile(filePath, "utf8");
  } catch {
    existing = "";
  }

  const lines = existing.split(/\r?\n/).filter(Boolean);
  const keys = new Set(Object.keys(values));
  const next = lines.map((line) => {
    const key = line.split("=")[0];
    if (keys.has(key)) {
      keys.delete(key);
      return `${key}=${values[key]}`;
    }
    return line;
  });

  for (const key of keys) {
    next.push(`${key}=${values[key]}`);
  }

  await fs.writeFile(filePath, `${next.join("\n")}\n`);
}

async function main() {
  const issuer = appendSlash(readArg("--issuer") ?? process.env.MODA_MCP_SERVER_URL ?? "https://mcp.moda.app/");
  const resource = appendSlash(readArg("--resource") ?? process.env.MODA_MCP_RESOURCE ?? issuer);
  const port = Number.parseInt(readArg("--port") ?? "8787", 10);
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const envPath = readArg("--env") ?? ".env.local";

  const metadata = await discover(issuer);
  const client = await registerClient(metadata, redirectUri);

  const state = base64Url(crypto.randomBytes(24));
  const codeVerifier = base64Url(crypto.randomBytes(48));
  const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());

  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("resource", resource);

  const callbackPromise = waitForCallback(port, state);

  console.log(`Open this URL to connect Moda MCP:\n${authUrl.toString()}\n`);
  execFile("open", [authUrl.toString()], () => undefined);

  const code = await callbackPromise;
  const token = await exchangeCode({ metadata, client, code, codeVerifier, redirectUri, resource });
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : "";

  await upsertEnv(envPath, {
    MODA_MCP_SERVER_URL: issuer.replace(/\/$/, ""),
    MODA_MCP_AUTH_MODE: "oauth",
    MODA_MCP_ACCESS_TOKEN: token.access_token,
    MODA_MCP_REFRESH_TOKEN: token.refresh_token ?? "",
    MODA_MCP_CLIENT_ID: client.client_id,
    MODA_MCP_CLIENT_SECRET: client.client_secret ?? "",
    MODA_MCP_TOKEN_ENDPOINT: metadata.token_endpoint,
    MODA_MCP_SCOPE: token.scope ?? "",
    MODA_MCP_RESOURCE: resource,
    MODA_MCP_EXPIRES_AT: expiresAt,
    MODA_MCP_TOKEN_ENDPOINT_AUTH: client.client_secret ? "client_secret_post" : "none",
  });

  console.log(`Wrote Moda MCP OAuth credential fields to ${envPath}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
