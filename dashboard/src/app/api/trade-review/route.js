import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';

const apiKey = process.env.OPENAI_API_KEY || '';
const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export async function POST(request) {
  if (!apiKey) {
    return NextResponse.json({
      success: false,
      error: 'OPENAI_API_KEY is not defined in the environment.'
    }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { trade, currentBtcPrice } = body;

    if (!trade) {
      return NextResponse.json({ success: false, error: 'Trade object is required.' }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey });

    const systemPrompt = `You are an expert AI trading coach and quantitative analyst. Your task is to perform a detailed post-mortem review of a logged options or crypto trade.
You will be provided with the trade details in JSON format, and optionally the current BTC price.

Your review MUST include the following sections and analysis:
1. Summary: A brief overview of the trade and its outcome.
2. What Went Right: Identify the good decisions, adherence to strategy, or accurate market reads.
3. What Went Wrong: Identify mistakes, poor timing, deviations from strategy, or misread market conditions.
4. Key Lesson: The primary takeaway the trader should learn from this execution.
5. Recommendation for Future: Actionable advice for similar market setups in the future.

In your analysis, you should:
- Analyze the trade's pre-trade view (4H trend, 24-48h forecast, support/resistance/entry) vs what actually happened.
- Compare the trader's human view vs the AI system recommendation (if provided in the trade data).
- Evaluate whether support/resistance levels held or broke based on the result.
- Assess the P&L outcome relative to the planned risk/reward setup.
- Check if the strategy was appropriate for the market conditions.

Be objective, constructive, and analytical. Use clear formatting (e.g., Markdown headers, bullet points, bold text) to make the review easy to read.`;

    const userPrompt = `Trade Details:
${JSON.stringify(trade, null, 2)}

${currentBtcPrice ? `Current BTC Price: $${currentBtcPrice}` : ''}
Please generate the post-mortem review based on the instructions.`;

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
    });

    const review = response.choices[0].message.content;

    return NextResponse.json({
      success: true,
      review: review
    });

  } catch (error) {
    console.error('API trade-review route error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
