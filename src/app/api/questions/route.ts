import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { z } from "zod";
import { questionInput } from "@/lib/validations/question";
import { difficultyLabel } from "@/lib/difficulty";

const paginationInput=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20)});

export async function GET(request:Request){
  const url=new URL(request.url);const category=url.searchParams.get("category");const type=url.searchParams.get("type");const difficulty=url.searchParams.get("difficulty");
  const parsed=paginationInput.safeParse({page:url.searchParams.get("page")??undefined,pageSize:url.searchParams.get("pageSize")??undefined});
  if(!parsed.success)return NextResponse.json({error:{code:"INVALID_INPUT",message:"分页参数不正确",details:parsed.error.flatten()}},{status:400});
  const {page,pageSize}=parsed.data;
  const where={status:"PUBLISHED" as const,...(category?{category:{name:category}}:{}),...(type?{type}:{}),...(difficulty?{difficulty}: {})};
  const [total,rows]=await prisma.$transaction([prisma.question.count({where}),prisma.question.findMany({where,include:{category:true},orderBy:{createdAt:"asc"},skip:(page-1)*pageSize,take:pageSize})]);
  return NextResponse.json({data:{items:rows.map(q=>({id:q.id,category:q.category.name,type:q.type,stem:q.stem,options:q.options,difficulty:q.difficulty,difficultyScore:q.difficultyScore})),page,pageSize,total,totalPages:Math.ceil(total/pageSize)}});
}
export async function POST(request:Request){const session=await getSession();if(session?.role!=="ADMIN")return NextResponse.json({error:{code:"FORBIDDEN",message:"无管理权限",details:null}},{status:403});const parsed=questionInput.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:{code:"INVALID_INPUT",message:"题目信息不完整",details:parsed.error.flatten()}},{status:400});const body=parsed.data;const category=await prisma.category.upsert({where:{name:body.category},update:{},create:{name:body.category}});const difficultyScore=body.difficultyScore??({基础:3,进阶:5.5,困难:8}[body.difficulty]);const row=await prisma.question.create({data:{categoryId:category.id,type:body.type,stem:body.stem,options:body.options,answer:body.answer,explanation:body.explanation,difficultyScore,difficulty:difficultyLabel(difficultyScore),status:body.status}});return NextResponse.json({data:row},{status:201});}
