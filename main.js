// Appwrite Function: AI Content Generator
// Generates AI summaries and content for articles

import { Client, Databases, Query } from 'node-appwrite';

// Environment variables
const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID;
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;
const APPWRITE_DB_ID = process.env.APPWRITE_DB_ID;
const ARTICLES_COLLECTION_ID = process.env.ARTICLES_COLLECTION_ID || 'dataset_plan';
const LINKLET_AI_COLLECTION_ID = process.env.LINKLET_AI_COLLECTION_ID || 'linklet_ai';

// AI API Configuration - OpenRouter with Llama 3.3
const OPENROUTER_API_KEY = "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";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "meta-llama/llama-3.3-8b-instruct:free";

export default async ({ req, res, log, error }) => {
  // Initialize Appwrite client
  const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

  const databases = new Databases(client);

  try {
    // Parse request body
    const payload = JSON.parse(req.body || '{}');
    const { articleIds } = payload;

    if (!articleIds || !Array.isArray(articleIds) || articleIds.length === 0) {
      return res.json({
        success: false,
        error: 'No article IDs provided',
      }, 400);
    }

    log(`Processing ${articleIds.length} articles for AI generation`);

    const results = {
      success: [],
      failed: [],
      skipped: [],
    };

    // Process each article
    for (const articleId of articleIds) {
      try {
        // Check if AI content already exists
        const existingAI = await databases.listDocuments(
          APPWRITE_DB_ID,
          LINKLET_AI_COLLECTION_ID,
          [Query.equal('article_id', articleId), Query.limit(1)]
        );

        if (existingAI.documents.length > 0) {
          log(`Article ${articleId} already has AI content, skipping`);
          results.skipped.push(articleId);
          continue;
        }

        // Fetch article data
        const article = await databases.getDocument(
          APPWRITE_DB_ID,
          ARTICLES_COLLECTION_ID,
          articleId
        );

        // Generate AI content
        const aiContent = await generateAIContent(article, log);

        // Store in linklet_ai collection
        await databases.createDocument(
          APPWRITE_DB_ID,
          LINKLET_AI_COLLECTION_ID,
          'unique()',
          {
            article_id: articleId,
            ai_summary: aiContent.summary,
            ai_content: aiContent.content,
          }
        );

        log(`Successfully generated AI content for article ${articleId}`);
        results.success.push(articleId);

      } catch (err) {
        error(`Failed to process article ${articleId}: ${err.message}`);
        results.failed.push({ articleId, error: err.message });
      }
    }

    return res.json({
      success: true,
      message: `Processed ${articleIds.length} articles`,
      results: {
        successful: results.success.length,
        failed: results.failed.length,
        skipped: results.skipped.length,
      },
      details: results,
    });

  } catch (err) {
    error(`Function error: ${err.message}`);
    return res.json({
      success: false,
      error: err.message,
    }, 500);
  }
};

// Generate AI summary and content using AI API
async function generateAIContent(article, log) {
  try {
    const articleText = `
Title: ${article.title}
Author: ${article.author || 'Unknown'}
Source: ${article.source}
Published: ${article.published_date}
Content: ${article.content || 'No content available'}
`;

    // Generate summary
    const summary = await callAI(
      `You are a professional news summarizer. Summarize the following article in 2-3 concise sentences. Focus on the key facts and main points.

${articleText}`,
      log,
      150
    );

    // Generate detailed content
    const content = await callAI(
      `You are a professional content analyst. Analyze the following article and provide:
1. Key Points (3-5 bullet points)
2. Main Entities (people, organizations, locations mentioned)
3. Context and Background (1-2 paragraphs)
4. Implications (what this means for readers)

Format your response in clear sections.

${articleText}`,
      log,
      800
    );

    return {
      summary: summary.trim(),
      content: content.trim(),
    };

  } catch (err) {
    throw new Error(`AI generation failed: ${err.message}`);
  }
}

// Call AI API (OpenAI compatible)
async function callAI(prompt, log, maxTokens = 500) {
  try {
    const response = await fetch(AI_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a professional news analyst and content generator.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;

  } catch (err) {
    log(`AI API call failed: ${err.message}`);
    throw err;
  }
}
