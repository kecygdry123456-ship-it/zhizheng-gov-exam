import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (isIP(normalized) !== 4) return false;
  const [a, b] = normalized.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function lookupBeforeDeadline(
  host: string,
  deadlineAt: number,
  lookupHost: typeof lookup,
) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Error("模型连接校验超时");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookupHost(host, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("模型域名解析超时")),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function normalizeModelBaseUrl(
  value: string,
  options: { deadlineAt?: number; lookupHost?: typeof lookup } = {},
) {
  const deadlineAt = options.deadlineAt || Date.now() + 10_000;
  const url = new URL(value);
  const insecureAllowed = process.env.NODE_ENV !== "production" || process.env.ALLOW_INSECURE_MODEL_BASE_URL === "1";
  if (url.protocol !== "https:" && !(insecureAllowed && url.protocol === "http:")) throw new Error("正式环境的 Base URL 必须使用 HTTPS");
  if (url.username || url.password) throw new Error("Base URL 不能包含账号或密码");
  const normalized = value.replace(/\/+$/, "");
  if (process.env.ALLOW_PRIVATE_MODEL_BASE_URL === "1") return normalized;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isPrivateAddress(host)) throw new Error("模型 Base URL 不能指向本机、内网或云元数据地址");
  const addresses = await lookupBeforeDeadline(
    host,
    deadlineAt,
    options.lookupHost || lookup,
  );
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new Error("模型 Base URL 解析到了不安全的网络地址");
  return normalized;
}
