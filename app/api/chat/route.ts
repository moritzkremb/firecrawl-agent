import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Define the search_web function for OpenAI function calling
const searchWebFunction = {
  name: "search_web",
  description: "Search the web using Firecrawl. Use operators like 'site:domain.com' to limit results to a specific site. Returns scraped content with screenshots. IMPORTANT: Always display the screenshot URL for each result in your response as an image or link.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query. Use 'site:domain.com' to search within a specific domain, 'inurl:' to find URLs containing specific text, etc."
      },
      limit: {
        type: "number",
        description: "Number of results to return (default: 5, max: 10)",
        default: 5
      }
    },
    required: ["query"]
  }
};

// Firecrawl search function
async function searchWithFirecrawl(query: string, limit: number = 5) {
  try {
    console.log(`🔍 Searching with Firecrawl: "${query}" (limit: ${limit})`);
    
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error('FIRECRAWL_API_KEY not configured');
    }

    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`
      },
      body: JSON.stringify({
        query: query,
        limit: Math.min(limit, 10),
        scrapeOptions: {
          formats: ["markdown", "screenshot@fullPage"]
        }
      })
    });

    const responseText = await response.text();
    console.log('📥 Firecrawl response status:', response.status);
    
    if (!response.ok) {
      console.error('❌ Firecrawl error response:', responseText);
      throw new Error(`Firecrawl API error: ${response.status} - ${responseText}`);
    }

    const data = JSON.parse(responseText);
    console.log(`✅ Found ${data.data?.length || 0} results`);
    
    // Debug: Log screenshot URLs
    if (data.data && data.data.length > 0) {
      console.log('📸 Screenshot URLs:');
      data.data.forEach((result: any, index: number) => {
        console.log(`  Result ${index + 1}: ${result.screenshot || 'No screenshot'}`);
      });
    }
    
    if (data.success && data.data && data.data.length > 0) {
      return {
        success: true,
        query: query,
        count: data.data.length,
        results: data.data.map((result: any) => ({
          title: result.title || 'Untitled',
          url: result.url || '',
          description: result.description || '',
          markdown: result.markdown || '',
          screenshot: result.screenshot || null,
          metadata: result.metadata || {}
        })),
        instruction: "IMPORTANT: For each result, you MUST display both the page link AND the screenshot. Format each result with its screenshot visible."
      };
    } else {
      return {
        success: false,
        query: query,
        count: 0,
        results: [],
        message: 'No results found'
      };
    }
    
  } catch (error) {
    console.error('❌ Search error:', error);
    return {
      success: false,
      query: query,
      error: error instanceof Error ? error.message : 'Unknown error',
      results: []
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid messages format' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Initial OpenAI call with function calling
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      tools: [{
        type: "function",
        function: searchWebFunction
      }],
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: 1000,
    });

    const message = completion.choices[0]?.message;
    
    if (!message) {
      return NextResponse.json({ error: 'No response from OpenAI' }, { status: 500 });
    }
    
    // Check if OpenAI wants to search the web
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      
      if (toolCall.function.name === 'search_web') {
        const args = JSON.parse(toolCall.function.arguments);
        
        // Execute the search
        const searchResults = await searchWithFirecrawl(args.query, args.limit || 5);
        
        // Send results back to OpenAI for final response
        const finalCompletion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant. When presenting search results, you MUST display the screenshot for each result. Use markdown to show images: ![Screenshot](url) or provide clickable links to screenshots. Never omit the screenshots from your response."
            },
            ...messages,
            message,
            {
              role: "tool",
              content: JSON.stringify(searchResults),
              tool_call_id: toolCall.id
            }
          ],
          temperature: 0.7,
          max_tokens: 2000,
        });
        
        return NextResponse.json({ 
          response: finalCompletion.choices[0]?.message?.content || 'No response generated',
          searchPerformed: true,
          query: args.query,
          resultsCount: searchResults.count || 0
        });
      }
    }

    // No search needed - return regular response
    return NextResponse.json({ 
      response: message.content || 'No response generated',
      searchPerformed: false
    });

  } catch (error) {
    console.error('❌ API route error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 