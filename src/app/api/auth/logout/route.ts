import { NextResponse } from "next/server";
import { cookies } from "next/headers";
export async function POST(){(await cookies()).delete("zx_session");return NextResponse.json({data:{ok:true}});}
