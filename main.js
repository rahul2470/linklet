const { Client, Databases, Query } = require('node-appwrite');

const OPENROUTER_API_KEY = 'sk-p8CjLLk8ECNgB39smKNZB8cE2jsmuUm30vnls2FzEeKOjE3D';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

module.exports = async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID || '')
    .setKey(process.env.APPWRITE_API_KEY || '');

  const databases = new Databases(client);
  const APPWRITE_DB_ID = process.env.APPWRITE_DB_ID || '';
  const ARTICLES_COLLECTION_ID = process.env.ARTICLES_COLLECTION_ID || 'dataset_plan';
  const LINKLET_AI_COLLECTION_ID = process.env.LINKLET_AI_COLLECTION_ID || 'linklet_ai';

  try {
    // Parse request body
    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (e) {
      log('Failed to parse request body, using empty object');
      body = { articleIds: [] };
    }

    const articleIds = body.articleIds || [];
    
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      log('No article IDs provided');
      return res.json({
        success: false,
        message: 'No article IDs provided. Expected format: { "articleIds": ["id1", "id2"] }',
      }, 400);
    }

    log(`Starting AI generation for ${articleIds.length} articles`);

    const results = {
      processed: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };

    // Process each article
    for (let i = 0; i < articleIds.length; i++) {
      const articleId = articleIds[i];
      log(`Processing article ${i + 1}/${articleIds.length}: ${articleId}`);

      try {
        // Check if AI data already exists
        const existingAI = await databases.listDocuments(
          APPWRITE_DB_ID,
          LINKLET_AI_COLLECTION_ID,
          [Query.equal('article_id', articleId), Query.limit(1)]
        );

        if (existingAI.documents.length > 0) {
          log(`Article ${articleId} already has AI data, skipping`);
          results.skipped++;
          results.details.push({
            article_id: articleId,
            status: 'skipped',
            reason: 'AI data already exists',
          });
          continue;
        }

        // Fetch article data
        log(`Fetching article data for ${articleId}`);
        const article = await databases.getDocument(
          APPWRITE_DB_ID,
          ARTICLES_COLLECTION_ID,
          articleId
        );

        // Validate article content
        if (!article.content || article.content.length < 50) {
          log(`Article ${articleId} has insufficient content (${article.content?.length || 0} chars)`);
          results.skipped++;
          results.details.push({
            article_id: articleId,
            status: 'skipped',
            reason: 'Insufficient content',
          });
          continue;
        }

        // Generate AI content
        log(`Generating AI content for ${articleId}`);
        const aiData = await generateAIContent(article, log, error);

        // Store in linklet_ai collection
        log(`Storing AI data for ${articleId}`);
        const newDoc = await databases.createDocument(
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
          document_id: newDoc.$id,
        });

        log(`✓ Successfully processed article: ${articleId}`);

        // Rate limiting delay (1 second between requests)
        if (i < articleIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (err) {
        error(`Failed to process article ${articleId}: ${err.message}`);
        console.error(err);
        results.failed++;
        results.details.push({
          article_id: articleId,
          status: 'failed',
          error: err.message,
        });
      }
    }

    log(`AI generation completed: ${results.processed} processed, ${results.skipped} skipped, ${results.failed} failed`);

    return res.json({
      success: true,
      message: 'AI content generation completed',
      results: results,
      summary: {
        total: articleIds.length,
        processed: results.processed,
        skipped: results.skipped,
        failed: results.failed,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    error(`Function error: ${err.message}`);
    console.error(err);
    return res.json({
      success: false,
      message: 'Internal function error',
      error: err.message,
      stack: err.stack,
    }, 500);
  }
};

async function generateAIContent(article, log, error) {
  const contentPreview = article.content.substring(0, 3000);
  
  const prompt = `Analyze this article and provide a JSON response with a summary and enhanced content.

Article Details:
Title: ${article.title}
Source: ${article.source}
Author: ${article.author || 'Unknown'}
Published: ${article.published_date}

Content:
${contentPreview}

Provide ONLY a valid JSON response in this exact format (no markdown, no code blocks, just JSON):
{
  "summary": "Write a concise 2-3 sentence summary here",
  "enhanced_content": "Write detailed analysis with key insights and main points here"
}`;

  try {
    log('Calling OpenRouter API...');
    
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': article.url || 'https://linklet.ai',
        'X-Title': 'Linklet AI Content Generator',
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a professional content analyzer. Always respond with valid JSON only, no additional text or markdown formatting.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    log('Parsing AI response...');
    
    // Try to extract JSON from response
    let parsed;
    try {
      // First try direct parse
      parsed = JSON.parse(content);
    } catch (e) {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in AI response');
      }
      parsed = JSON.parse(jsonMatch[0]);
    }

    // Validate required fields
    if (!parsed.summary || !parsed.enhanced_content) {
      throw new Error('Missing required fields in AI response');
    }

    log('AI content generated successfully');

    return {
      ai_summary: parsed.summary.trim().substring(0, 1000), // Limit to 1000 chars
      ai_content: parsed.enhanced_content.trim().substring(0, 5000), // Limit to 5000 chars
    };

  } catch (err) {
    error(`AI generation error: ${err.message}`);
    
    // Fallback to basic summary from content
    log('Using fallback content generation');
    
    const words = article.content.split(' ');
    const summaryLength = Math.min(words.length, 50);
    const summary = words.slice(0, summaryLength).join(' ') + '...';

    return {
      ai_summary: summary.substring(0, 500),
      ai_content: `This article from ${article.source} discusses: ${article.title}. Published on ${article.published_date}. For complete details, please refer to the original source at ${article.url}`,
    };
  }
}
