// Appwrite Function: AI Content Generator
// This function generates AI summaries and content for articles missing them

import { Client, Databases, Query } from 'node-appwrite';

const OPENROUTER_API_KEY = 'sk-p8CjLLk8ECNgB39smKNZB8cE2jsmuUm30vnls2FzEeKOjE3D';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface Article {
  $id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  author: string;
  published_date: string;
}

interface AIData {
  ai_summary: string;
  ai_content: string;
}

export default async ({ req, res, log, error }: any) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || '')
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID || '')
    .setKey(process.env.APPWRITE_API_KEY || '');

  const databases = new Databases(client);
  const APPWRITE_DB_ID = process.env.APPWRITE_DB_ID || '';
  const ARTICLES_COLLECTION_ID = process.env.ARTICLES_COLLECTION_ID || 'dataset_plan';
  const LINKLET_AI_COLLECTION_ID = process.env.LINKLET_AI_COLLECTION_ID || 'linklet_ai';

  try {
    // Parse request body
    const body = JSON.parse(req.body || '{}');
    const articleIds = body.articleIds || [];
    
    if (articleIds.length === 0) {
      return res.json({
        success: false,
        message: 'No article IDs provided',
      }, 400);
    }

    log(`Processing ${articleIds.length} articles`);

    const results = {
      processed: 0,
      failed: 0,
      skipped: 0,
      details: [] as any[],
    };

    // Process each article
    for (const articleId of articleIds) {
      try {
        // Check if AI data already exists
        const existingAI = await databases.listDocuments(
          APPWRITE_DB_ID,
          LINKLET_AI_COLLECTION_ID,
          [Query.equal('article_id', articleId)]
        );

        if (existingAI.documents.length > 0) {
          log(`Article ${articleId} already has AI data, skipping`);
          results.skipped++;
          continue;
        }

        // Fetch article data
        const article = await databases.getDocument(
          APPWRITE_DB_ID,
          ARTICLES_COLLECTION_ID,
          articleId
        ) as any as Article;

        // Generate AI summary and content
        const aiData = await generateAIContent(article, log);

        // Store in linklet_ai collection
        await databases.createDocument(
          APPWRITE_DB_ID,
          LINKLET_AI_COLLECTION_ID,
          'unique()',
          {
            article_id: articleId,
            ai_summary: aiData.ai_summary,
            ai_content: aiData.ai_content,
            generated_at: new Date().toISOString(),
          }
        );

        results.processed++;
        results.details.push({
          article_id: articleId,
          status: 'success',
          title: article.title,
        });

        log(`Successfully generated AI content for article: ${articleId}`);

      } catch (err: any) {
        error(`Failed to process article ${articleId}: ${err.message}`);
        results.failed++;
        results.details.push({
          article_id: articleId,
          status: 'failed',
          error: err.message,
        });
      }
    }

    return res.json({
      success: true,
      message: 'AI content generation completed',
      results,
      timestamp: new Date().toISOString(),
    });

  } catch (err: any) {
    error(`Function error: ${err.message}`);
    return res.json({
      success: false,
      message: 'Internal function error',
      error: err.message,
    }, 500);
  }
};

async function generateAIContent(article: Article, log: any): Promise<AIData> {
  const prompt = `You are an AI content analyzer. Analyze the following article and provide:

1. A concise summary (2-3 sentences)
2. Enhanced content with key insights, main points, and analysis

Article Details:
Title: ${article.title}
Source: ${article.source}
Author: ${article.author}
Published: ${article.published_date}
URL: ${article.url}

Content:
${article.content}

Provide your response in the following JSON format:
{
  "summary": "Your 2-3 sentence summary here",
  "enhanced_content": "Your detailed analysis and key insights here"
}`;

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': article.url,
        'X-Title': 'Linklet AI Content Generator',
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a professional content analyzer. Provide concise summaries and enhanced content analysis in JSON format.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse AI response as JSON');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      ai_summary: parsed.summary || 'Summary generation failed',
      ai_content: parsed.enhanced_content || 'Content enhancement failed',
    };

  } catch (err: any) {
    log(`AI generation error: ${err.message}`);
    
    // Fallback to basic summary
    return {
      ai_summary: article.content.substring(0, 200) + '...',
      ai_content: `Key article from ${article.source} covering important topics. Full content available at the source.`,
    };
  }
}
