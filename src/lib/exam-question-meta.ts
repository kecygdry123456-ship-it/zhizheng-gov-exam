import {
  EXAM_TEMPLATES,
  isExamTemplateId,
  type ExamTemplateId,
} from "@/lib/exam-templates";

export type ExamQuestionMeta = {
  id: string;
  section?: string;
  subtype?: string;
};

export function buildExamQuestionMeta(
  questionIds: string[],
  templateId: unknown,
): ExamQuestionMeta[] {
  if (!isExamTemplateId(templateId))
    return questionIds.map((id) => ({ id }));
  const template = EXAM_TEMPLATES[templateId];
  if (template.questionCount !== questionIds.length)
    return questionIds.map((id) => ({ id }));
  let offset = 0;
  return template.sections.flatMap((section) => {
    const rows = questionIds
      .slice(offset, offset + section.count)
      .map((id, indexInSection) => {
        let subtypeOffset = 0;
        const subtype = section.subtypes?.find((item) => {
          const contains =
            indexInSection >= subtypeOffset &&
            indexInSection < subtypeOffset + item.count;
          subtypeOffset += item.count;
          return contains;
        });
        return { id, section: section.label, subtype: subtype?.label };
      });
    offset += section.count;
    return rows;
  });
}

export function parseExamQuestionMeta(
  value: unknown,
  questionIds: string[],
  templateId: unknown,
) {
  if (Array.isArray(value)) {
    const parsed = value.filter(
      (item): item is ExamQuestionMeta =>
        Boolean(
          item &&
            typeof item === "object" &&
            "id" in item &&
            typeof item.id === "string",
        ),
    );
    if (
      parsed.length === questionIds.length &&
      parsed.every((item, index) => item.id === questionIds[index])
    )
      return parsed;
  }
  return buildExamQuestionMeta(questionIds, templateId as ExamTemplateId);
}
