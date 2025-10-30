import OpenAI from "openai";

export default async ({ req, res, log, error }) => {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Dummy paragraph for testing
    const article = {
      title: "AI Revolution in Newsrooms",
      content: `
        Artificial Intelligence is transforming how journalists collect, analyze, and distribute news. 
        From automated fact-checking to personalized news delivery, AI tools are reshaping media workflows.
        However, ethical considerations and bias remain major concerns in implementing AI within journalism.
      `,
    };

    // Generate AI summary and meta content
    const prompt = `
      Generate a clear and engaging summary for this article and a suitable title slug:
      Title: ${article.title}
      Content: ${article.content}
    `;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a professional news content summarizer." },
        { role: "user", content: prompt },
      ],
    });

    const aiResponse = completion.choices[0].message.content;

    return res.json({
      success: true,
      article: article.title,
      aiSummary: aiResponse,
    });
  } catch (err) {
    error(err);
    return res.json({
      success: false,
      message: err.message,
    });
  }
};
