import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { InvalidInputError, parseInput, triage } from "./triage.mjs";

const HTML = await readFile(new URL("./index.html", import.meta.url), "utf8");
const MAX_BODY_BYTES = 1_000_000;

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleTriage(request, response) {
  let body;
  try {
    body = await readBody(request);
  } catch {
    return json(response, 400, { status: "invalid_input" });
  }

  let text;
  try {
    text = parseInput(body);
  } catch (error) {
    if (error instanceof InvalidInputError) {
      return json(response, 400, { status: "invalid_input" });
    }
    throw error;
  }

  const result = await triage(text);
  return json(response, 200, result);
}

export function createApp() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && (request.url === "/" || request.url === "/index.html")) {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(HTML);
      return;
    }

    if (request.method === "POST" && request.url === "/api/triage") {
      try {
        await handleTriage(request, response);
      } catch {
        if (!response.headersSent) json(response, 500, { status: "server_error" });
      }
      return;
    }

    return json(response, 404, { status: "not_found" });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, "127.0.0.1", () => {
    console.log(`Triage app: http://127.0.0.1:${port}`);
  });
}
