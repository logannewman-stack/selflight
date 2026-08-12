// The one route a connector token passes through.
//
// public.connector_secrets has row-level security on and no policies at all, so
// no signed-in user — not even the token's owner — can read or write it. Only
// this function can, using the service-role key. A token goes in from the
// browser once and is never sent back out.

import { db, hasSupabase, userFromRequest } from "./_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });
  if (!hasSupabase) return json(res, 501, { error: "No Supabase project is configured." });

  const user = await userFromRequest(req);
  if (!user) return json(res, 401, { error: "Sign in first." });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: "Could not parse the request body." });
  }

  const connectorId = String(body.connectorId || "");
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!connectorId) return json(res, 400, { error: "Which connector?" });

  const client = db();

  // The service role can see every row, so ownership has to be checked here
  // rather than left to the database.
  const { data: connector } = await client
    .from("connectors")
    .select("id")
    .eq("id", connectorId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!connector) return json(res, 404, { error: "No such connector." });

  const failed = token
    ? await write(client, connectorId, user.id, token)
    : await clear(client, connectorId);

  if (failed) {
    console.error(`[api/connectors] ${failed.message}`);
    return json(res, 500, { error: "Couldn't save that token." });
  }

  return json(res, 200, { ok: true, hasToken: Boolean(token) });
}

async function write(client, connectorId, userId, token) {
  const { error } = await client
    .from("connector_secrets")
    .upsert(
      { connector_id: connectorId, user_id: userId, token, updated_at: new Date().toISOString() },
      { onConflict: "connector_id" }
    );
  if (error) return error;

  // Set by the server so the flag can't claim a token that isn't there.
  return (await client.from("connectors").update({ has_token: true }).eq("id", connectorId)).error;
}

async function clear(client, connectorId) {
  const { error } = await client.from("connector_secrets").delete().eq("connector_id", connectorId);
  if (error) return error;
  return (await client.from("connectors").update({ has_token: false }).eq("id", connectorId)).error;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
