import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
export async function DELETE(_request:Request,{params}:{params:Promise<{questionId:string}>}){const s=await getSession();if(!s?.id)return NextResponse.json({error:{code:"UNAUTHORIZED",message:"请先登录"}},{status:401});const {questionId}=await params;await prisma.favorite.deleteMany({where:{userId:String(s.id),questionId}});return NextResponse.json({data:{favorite:false}});}
