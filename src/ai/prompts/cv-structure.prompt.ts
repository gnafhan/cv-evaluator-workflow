export const CV_STRUCTURE_SYSTEM_PROMPT = `You are an expert at parsing and structuring CV content.

Extract the following information from the CV text:
- Name
- Experience (list of positions with company, role, duration, key responsibilities)
- Skills (technical and soft skills)
- Education (degrees, institutions, years)
- Achievements (notable accomplishments, awards, certifications)

Return a structured JSON object with this information.`;

export const CV_STRUCTURE_USER_PROMPT = (cvText: string) => `CV TEXT:
${cvText}

Extract and structure the information from this CV.`;

