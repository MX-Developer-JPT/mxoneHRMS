import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { question, conversationHistory } = await req.json();
    if (!question) {
      return Response.json({ error: 'Question is required' }, { status: 400 });
    }

    // Load active policies from CompanyPolicy entity
    let policyFileUrls = [];
    try {
      const policies = await base44.asServiceRole.entities.CompanyPolicy.filter({ is_active: true });
      policyFileUrls = policies
        .filter(p => p.file_url)
        .map(p => p.file_url);
    } catch (e) {
      console.warn('Could not load policies from entity, using defaults:', e.message);
      // Fallback to hardcoded policy URLs
      policyFileUrls = [
        "https://media.base44.com/files/public/69b2589fe9733a8a7ea36c5c/756118971_UniformandSafetyGearAccountabilityPolicy.pdf",
        "https://media.base44.com/files/public/69b2589fe9733a8a7ea36c5c/a9580f0a2_GratuityPolicy-P003.pdf",
        "https://media.base44.com/files/public/69b2589fe9733a8a7ea36c5c/d1ba8a4f4_NewTravelPolicy1.pdf",
        "https://media.base44.com/files/public/69b2589fe9733a8a7ea36c5c/16d798279_AttendanceLeavePolicy-P0021.pdf",
        "https://media.base44.com/files/public/69b2589fe9733a8a7ea36c5c/de6fa834f_MaternityLeavePolicy-P004.pdf",
        "https://media.base44.com/files/public/69b2589fe9733a8a7ea36c5c/b09462e73_PaternityLeavePolicy-P005.pdf",
        "https://media.base44.com/files/public/69b2589fe9733a8a7ea36c5c/c73169bd9_FlexiHrspolicy1.pdf",
        "https://media.base44.com/files/public/69b2589fe9733a8a7ea36c5c/912cb871e_ZEROTOLERANCEPOLICY1.pdf"
      ];
    }

    // Build conversation context from history
    const historyContext = conversationHistory && conversationHistory.length > 0
      ? conversationHistory.map(m => `${m.role === 'user' ? 'Employee' : 'AskMax'}: ${m.content}`).join('\n')
      : '';

    const prompt = `You are AskMax, a helpful and friendly HR assistant for Maxvolt Energy Industries Limited. 
You help employees understand company policies and answer general workplace questions.

${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}Employee question: ${question}

Instructions:
- Answer based on the company policy documents provided. If the answer is in the policies, cite the relevant policy.
- For general questions not covered by the policies, answer helpfully using your general knowledge.
- Be concise, friendly, and professional.
- If you're unsure about something specific to Maxvolt, suggest the employee contact HR.
- Format your response clearly with bullet points or numbered lists where appropriate.`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      file_urls: policyFileUrls.length > 0 ? policyFileUrls : undefined,
      model: 'gemini_3_flash'
    });

    return Response.json({ answer: response });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});