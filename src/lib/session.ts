import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
function sessionKey() {
  const secret = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : "local-development-session-key-change-me");
  if (!secret) throw new Error("生产环境必须配置 SESSION_SECRET");
  return new TextEncoder().encode(secret);
}
export async function createSession(payload:{id:string;name:string;role:string}){
  const token=await new SignJWT(payload).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("7d").sign(sessionKey());
  const configuredSecure = process.env.COOKIE_SECURE?.trim().toLowerCase();
  const forwardedProtocol = (await headers()).get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const secure = configuredSecure === "1" ||
    (configuredSecure !== "0" && forwardedProtocol === "https");
  (await cookies()).set("zx_session",token,{httpOnly:true,sameSite:"lax",secure,path:"/",maxAge:604800});
}
export async function getSession(){try{const token=(await cookies()).get("zx_session")?.value;if(!token)return null;return (await jwtVerify(token,sessionKey())).payload}catch{return null}}
