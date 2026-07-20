import Image from "next/image";
import { QuestionContent } from "./question-content";
import type { QuestionMaterial } from "./types";

export function MaterialView({ material, questionCount = 5, variant = "card" }: { material: QuestionMaterial; questionCount?: number; variant?: "card" | "pane" }) {
  return <div className={variant === "pane" ? "material-view-pane" : "mb-6 min-w-0 max-w-full overflow-hidden rounded-xl border border-blue-100 bg-blue-50/50 p-4 sm:p-5"}><div className="material-view-heading mb-4 flex items-center justify-between gap-2"><span className="material-label">材料</span><span className="material-context-label text-xs text-blue-600">资料分析公共材料 · 本材料对应 {questionCount} 道题</span></div><div className="material-view-content min-w-0 max-w-full space-y-4 text-sm leading-7 text-slate-700">{material.blocks.map((block, index) => {
    if (block.type === "richText") return <p key={index}><QuestionContent content={block.content} /></p>;
    if (block.type === "text") return <p key={index}>{block.content}</p>;
    if (block.type === "image") return <div key={index} className="material-image-wrap overflow-auto rounded-lg bg-white p-2" aria-label="材料图片"><Image src={block.url} alt={block.alt} width={1200} height={840} unoptimized className="material-image h-auto w-full max-w-full" /></div>;
    return <div key={index} className="mobile-scroll overflow-x-auto" aria-label="材料表格，可横向滑动查看"><table className="min-w-full border-collapse bg-white text-center text-xs"><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-nowrap border border-slate-200 px-3 py-2">{cell}</td>)}</tr>)}</tbody></table></div>;
  })}</div></div>;
}
