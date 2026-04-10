import express from "express";
import { config } from "./config.js";
import { ManagedSlackModaAgent, buildFallbackErrorPayload, normalizeExports } from "./lib/anthropic.js";
import { downloadToBuffer } from "./lib/download.js";
import { logger } from "./lib/logger.js";
import { addReaction, getUser, postMessage, removeReaction, uploadPdfFromBuffer, verifySlackSignature } from "./lib/slack.js";
import { stateStore } from "./lib/state.js";

interface SlackEnvelope {
  type?: string;
  challenge?: string;
  event_id?: string;
  team_id?: string;
  authorizations?: Array<{ team_id?: string; user_id?: string }>;
  event?: {
    type?: string;
    subtype?: string;
    text?: string;
    user?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
  };
}

function teamIdFor(body: SlackEnvelope): string | undefined {
  return body.team_id ?? body.authorizations?.[0]?.team_id;
}

function textMentionsBot(text: string): boolean {
  return Boolean(config.slackBotUserId && text.includes(`<@${config.slackBotUserId}>`));
}

function allowedByConfig(channel: string, user: string): boolean {
  if (config.slackAllowedChannelIds.length > 0 && !config.slackAllowedChannelIds.includes(channel)) {
    return false;
  }

  if (config.slackAllowedUserIds.length > 0 && !config.slackAllowedUserIds.includes(user)) {
    return false;
  }

  return true;
}

function inferInProgressMessage(text: string): string | null {
  const lower = text.toLowerCase();
  const isCreate = /\b(create|generate|new version|make a new|build)\b/.test(lower);
  const isUpdate = /\b(update|edit|change|revise|modify|refresh|personalize|personalise|clone|remix)\b/.test(lower);
  const isExport = /\b(export|pdf|download|send me the file)\b/.test(lower);

  if (isCreate) {
    return "Starting creation now. New collateral usually takes about 5 to 6 minutes. I’ll post the result in this thread when it’s ready.";
  }

  if (isUpdate && isExport) {
    return "Starting the update and export now. Updates usually take about 2 to 3 minutes, then I’ll post the exported PDF here.";
  }

  if (isUpdate) {
    return "Starting the update now. Updates usually take about 2 to 3 minutes. I’ll post back here when it’s done.";
  }

  if (isExport) {
    return "Starting the export now. PDF exports can take a minute or two. I’ll post the file in this thread when it’s ready.";
  }

  return null;
}

export function createServer(agent: ManagedSlackModaAgent) {
  const app = express();
  const processedEvents = new Set<string>();

  function rememberEvent(key: string) {
    processedEvents.add(key);
    setTimeout(() => {
      processedEvents.delete(key);
    }, 10 * 60 * 1000);
  }

  app.use((req, _res, next) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      (req as express.Request & { rawBody: string; parsedBody?: SlackEnvelope }).rawBody = rawBody;
      try {
        (req as express.Request & { rawBody: string; parsedBody?: SlackEnvelope }).parsedBody = JSON.parse(rawBody) as SlackEnvelope;
      } catch {
        (req as express.Request & { rawBody: string; parsedBody?: SlackEnvelope }).parsedBody = {};
      }
      next();
    });
  });

  app.get("/", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/", async (req, res) => {
    const typedReq = req as express.Request & { rawBody: string; parsedBody?: SlackEnvelope };
    const body = typedReq.parsedBody ?? {};
    const retryNum = req.headers["x-slack-retry-num"] as string | undefined;

    const signature = req.headers["x-slack-signature"] as string | undefined;
    const timestamp = req.headers["x-slack-request-timestamp"] as string | undefined;
    if (!verifySlackSignature(typedReq.rawBody, signature, timestamp)) {
      return res.status(401).json({ error: "Invalid Slack signature" });
    }

    if (config.slackTeamId && teamIdFor(body) && teamIdFor(body) !== config.slackTeamId) {
      return res.status(403).json({ error: "Unexpected Slack team" });
    }

    if (body.type === "url_verification" && body.challenge) {
      return res.json({ challenge: body.challenge });
    }

    res.status(200).send("");

    const event = body.event;
    if (!event || !event.text || !event.channel || !event.ts || !event.user) {
      return;
    }

    const dedupeKey = body.event_id ?? `${event.channel}:${event.ts}:${event.type}`;
    if (processedEvents.has(dedupeKey)) {
      logger.info("Ignored duplicate Slack event", { dedupeKey, retryNum });
      return;
    }
    rememberEvent(dedupeKey);

    if (event.bot_id || event.subtype === "bot_message" || event.subtype === "message_changed") {
      return;
    }

    if (!allowedByConfig(event.channel, event.user)) {
      logger.info("Ignored Slack event outside allowlist", { channel: event.channel, user: event.user });
      return;
    }

    const threadTs = event.thread_ts ?? event.ts;
    const existingThread = await stateStore.getThread(`${event.channel}:${threadTs}`);
    const isMention = event.type === "app_mention" || textMentionsBot(event.text);
    const isKnownThreadReply = event.type === "message" && event.thread_ts && existingThread;

    if (!isMention && !isKnownThreadReply) {
      return;
    }

    const cleanedText = event.text.replace(/<@[^>]+>/g, "").trim();
    const requester = await getUser(event.user);
    const inProgressMessage = inferInProgressMessage(cleanedText);

    try {
      await addReaction(event.channel, event.ts, "eyes");
    } catch {
      return;
    }

    try {
      if (inProgressMessage) {
        await postMessage(event.channel, inProgressMessage, threadTs);
      }

      const payload = normalizeExports(
        await agent.handleSlackMessage({
          channel: event.channel,
          threadTs,
          requesterUserId: requester.id,
          requesterName: requester.name,
          text: cleanedText,
        })
      );

      if (payload.exports && payload.exports.length > 0) {
        let first = true;
        for (const exportRef of payload.exports) {
          const buffer = await downloadToBuffer(exportRef.download_url);
          await uploadPdfFromBuffer(
            event.channel,
            threadTs,
            buffer,
            exportRef.filename,
            exportRef.title,
            first ? payload.summary : undefined
          );
          first = false;
        }

        if (payload.follow_up) {
          await postMessage(event.channel, payload.follow_up, threadTs);
        }
      } else {
        await postMessage(event.channel, payload.summary, threadTs);
        if (payload.follow_up && !payload.summary.includes(payload.follow_up)) {
          await postMessage(event.channel, payload.follow_up, threadTs);
        }
      }
    } catch (error) {
      logger.error("Failed to handle Slack event", error, { channel: event.channel, threadTs });
      const fallback = buildFallbackErrorPayload(error);
      await postMessage(event.channel, fallback.summary, threadTs);
    } finally {
      await removeReaction(event.channel, event.ts, "eyes");
    }
  });

  return app;
}
