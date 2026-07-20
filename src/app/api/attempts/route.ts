import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
export async function GET(){const session=await getSession();if(!session?.id)return NextResponse.json({error:{code:"UNAUTHORIZED",message:"请先登录"}},{status:401});const rows=await prisma.attempt.findMany({where:{userId:String(session.id)},include:{question:{include:{category:true}}},orderBy:{createdAt:"desc"}});return NextResponse.json({data:rows});}
