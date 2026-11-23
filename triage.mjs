import { classify } from "./mock-ai.mjs";

export const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);
export const MODEL_TIMEOUT_MS = 300;

export class InvalidInputError extends Error {
  constructor(reason = "invalid_input") {
    super(reason);
    this.name = "InvalidInputError";
    this.reason = reason;
  }
}

/**
 * Разбирает тело запроса и возвращает текст заявки.
 * Бросает InvalidInputError на битый JSON, не-объект, пустой/нестроковый text.
 */
export function parseInput(rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new InvalidInputError("malformed_json");
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidInputError("not_an_object");
  }
  const { text } = payload;
  if (typeof text !== "string" || text.trim() === "") {
    throw new InvalidInputError("empty_text");
  }
  return text.trim();
}

/**
 * Разбирает ответ модели. Возвращает {topic, draft} или null.
 * null = «ответ неподходящий»: не JSON, неизвестная тема, пустой черновик.
 */
export function parseModelOutput(raw) {
  if (typeof raw !== "string") return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const { topic, draft } = data;
  if (typeof topic !== "string" || !ALLOWED_TOPICS.has(topic)) return null;
  if (typeof draft !== "string" || draft.trim() === "") return null;
  return { topic, draft: draft.trim() };
}

function timeoutAfter(ms, onTimeout) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error("model_timeout"));
    }, ms);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

/**
 * Один проход: вход -> имитатор AI -> результат для API.
 * Любой сбой (таймаут, ошибка, неподходящий ответ) даёт manual_review.
 */
export async function triage(text) {
  const controller = new AbortController();
  const { promise: timedOut, clear } = timeoutAfter(MODEL_TIMEOUT_MS, () => controller.abort());
  try {
    const work = classify(text, { signal: controller.signal });
    // Таймаут может выиграть гонку раньше, чем classify отклонится.
    // Гасим поздний отказ, чтобы он не стал unhandled rejection.
    work.catch(() => {});
    const raw = await Promise.race([work, timedOut]);
    const parsed = parseModelOutput(raw);
    if (!parsed) return { status: "manual_review", topic: null, draft: null };
    return { status: "ready", topic: parsed.topic, draft: parsed.draft };
  } catch {
    return { status: "manual_review", topic: null, draft: null };
  } finally {
    clear();
  }
}
