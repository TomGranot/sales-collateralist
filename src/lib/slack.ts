import crypto from "node:crypto";
import { WebClient } from "@slack/web-api";
import { config } from "../config.js";

const slack = new WebClient(config.slackBotToken);

export interface SlackUser {
  id: string;
  name: string;
}

export function verifySlackSignature(rawBody: string, signature: string | undefined, timestamp: string | undefined): boolean {
  if (!signature || !timestamp) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const parsedTimestamp = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsedTimestamp) || Math.abs(now - parsedTimestamp) > 60 * 5) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = crypto.createHmac("sha256", config.slackSigningSecret).update(base).digest("hex");
  const expected = `v0=${digest}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function addReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
  await slack.reactions.add({ channel, timestamp, name: emoji });
}

export async function removeReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
  try {
    await slack.reactions.remove({ channel, timestamp, name: emoji });
  } catch {
    return;
  }
}

export async function postMessage(channel: string, text: string, threadTs: string): Promise<void> {
  await slack.chat.postMessage({ channel, text, thread_ts: threadTs });
}

export async function uploadPdfFromBuffer(
  channel: string,
  threadTs: string,
  buffer: Buffer,
  filename: string,
  title: string,
  initialComment?: string
): Promise<void> {
  await slack.files.uploadV2({
    channel_id: channel,
    thread_ts: threadTs,
    file: buffer,
    filename,
    title,
    initial_comment: initialComment,
  } as never);
}

export async function getUser(userId: string): Promise<SlackUser> {
  const response = await slack.users.info({ user: userId });
  const profile = response.user?.profile;
  const fullName = profile?.real_name || response.user?.real_name || response.user?.name || userId;

  return {
    id: userId,
    name: fullName,
  };
}
