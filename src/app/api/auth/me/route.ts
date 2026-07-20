import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
export async function GET(){const session=await getSession();if(!session?.id)return NextResponse.json({error:{code:"UNAUTHORIZED",message:"请先登录"}},{status:401});const user=await prisma.user.findUnique({where:{id:String(session.id)},select:{id:true,name:true,email:true,role:true,targetExam:true}});if(!user)return NextResponse.json({error:{code:"UNAUTHORIZED",message:"会话已失效"}},{status:401});return NextResponse.json({data:user});}
