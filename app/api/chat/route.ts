import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Step 1: Define function schemas for OpenAI function calling
const functions = [
  {
    name: "search_web",
    description: "Search the web for information and get full content from search results including full page screenshots. Can handle both general searches and specific website content. When user provides a specific URL, use 'site:domain.com' to search that specific site. When user asks general questions, search the open web. Full page screenshots are automatically captured for each result and returned as image URLs.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query. For specific URLs, format as 'site:domain.com' or 'site:domain.com your search terms'. For general searches, use natural language queries."
        },
        limit: {
          type: "number",
          description: "Number of search results to return and scrape (default: 5, max: 10)",
          default: 5,
          minimum: 1,
          maximum: 10
        },
        lang: {
          type: "string",
          description: "Language for search results",
          default: "en"
        },
        country: {
          type: "string", 
          description: "Country code for localized results",
          default: "us"
        }
      },
      required: ["query"]
    }
  }
];

// Step 4: Firecrawl Search API integration function
async function searchWithFirecrawl(query: string, limit: number = 5, lang: string = "en", country: string = "us") {
  try {
    console.log(`🔍 Searching web for: "${query}" with Firecrawl...`);
    
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error('Firecrawl API key not configured');
    }

    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`
      },
      body: JSON.stringify({
        query: query,
        limit: Math.min(limit, 10), // Cap at 10 for performance
        lang: lang,
        country: country,
        scrapeOptions: {
          formats: ["markdown", "screenshot@fullPage"]
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Firecrawl Search API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Successfully searched for: "${query}", found ${data.data?.length || 0} results`);
    
    if (data.success && data.data && data.data.length > 0) {
      return {
        success: true,
        query: query,
        resultsCount: data.data.length,
        results: data.data.map((result: any) => ({
          title: result.title || 'No title',
          url: result.url || '',
          description: result.description || '',
          markdown: result.markdown || 'No content available',
          screenshot: result.screenshot || null,
          metadata: result.metadata || {}
        })),
        summary: `Found ${data.data.length} results for "${query}"`
      };
    } else {
      throw new Error('Firecrawl search returned no results');
    }
    
  } catch (error) {
    console.error(`❌ Error searching for "${query}":`, error);
    return {
      success: false,
      query: query,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      results: [],
      summary: `Failed to search for "${query}". Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch (error) {
      console.error('❌ Failed to parse request body:', error);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { messages } = body;

    // Enhanced debugging
    console.log('🔍 API Key exists:', !!process.env.OPENAI_API_KEY);
    console.log('📝 Messages received:', messages?.length || 0);

    if (!messages || !Array.isArray(messages)) {
      console.error('❌ Invalid messages format');
      return NextResponse.json(
        { error: 'Messages must be an array' },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ OpenAI API key not found in environment variables');
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to your .env.local file.' },
        { status: 500 }
      );
    }

    // Step 2: Chat completion WITH function calling
    console.log('🚀 Making OpenAI API call with GPT-4o-mini and function calling...');
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages,
        tools: functions.map(func => ({
          type: "function",
          function: func
        })),
        tool_choice: "auto", // Let AI decide when to call functions
        temperature: 0.7,
        max_tokens: 1000,
      });
      console.log('✅ OpenAI API call successful');
    } catch (error) {
      console.error('❌ OpenAI API call failed:', error);
      return NextResponse.json(
        { error: 'Failed to get response from OpenAI', details: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }

    const message = completion.choices[0]?.message;
    
    if (!message) {
      console.error('❌ No message in OpenAI response');
      return NextResponse.json(
        { error: 'No response generated by OpenAI' },
        { status: 500 }
      );
    }
    
    // Step 3: Check if OpenAI wants to call a function
    if (message?.tool_calls && message.tool_calls.length > 0) {
      console.log('🔧 Function calls requested:', message.tool_calls.length);
      
      // Process all tool calls and collect results
      const toolResults = [];
      let searchQuery = '';
      let resultsCount = 0;
      
      for (const toolCall of message.tool_calls) {
        console.log('🔧 Processing tool call:', toolCall.function.name);
        
        const functionName = toolCall.function.name;
        
        // Validate function arguments exist and are not undefined
        if (!toolCall.function.arguments) {
          console.error('❌ Function arguments are missing or undefined for tool call:', toolCall.id);
          toolResults.push({
            role: "tool" as const,
            content: JSON.stringify({ error: 'Function arguments missing' }),
            tool_call_id: toolCall.id
          });
          continue;
        }
        
        let functionArgs;
        try {
          console.log('🔍 Raw function arguments:', toolCall.function.arguments);
          functionArgs = JSON.parse(toolCall.function.arguments);
        } catch (error) {
          console.error('❌ Failed to parse function arguments:', error);
          toolResults.push({
            role: "tool" as const,
            content: JSON.stringify({ error: 'Invalid function arguments' }),
            tool_call_id: toolCall.id
          });
          continue;
        }
        
        if (functionName === 'search_web') {
          // Execute the Firecrawl Search API call
          const searchData = await searchWithFirecrawl(
            functionArgs.query, 
            functionArgs.limit || 5,
            functionArgs.lang || 'en',
            functionArgs.country || 'us'
          );
          
          searchQuery = functionArgs.query;
          resultsCount = searchData.resultsCount || 0;
          
          toolResults.push({
            role: "tool" as const,
            content: JSON.stringify(searchData),
            tool_call_id: toolCall.id
          });
        } else {
          // Unknown function
          toolResults.push({
            role: "tool" as const,
            content: JSON.stringify({ error: `Unknown function: ${functionName}` }),
            tool_call_id: toolCall.id
          });
        }
      }
      
      // Send all tool results back to OpenAI
      let secondCompletion;
      try {
        secondCompletion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            ...messages,
            message,
            ...toolResults
          ],
          temperature: 0.7,
          max_tokens: 1500,
        });
      } catch (error) {
        console.error('❌ Second OpenAI API call failed:', error);
        return NextResponse.json(
          { error: 'Failed to process search results', details: error instanceof Error ? error.message : 'Unknown error' },
          { status: 500 }
        );
      }
      
      const finalResponse = secondCompletion.choices[0]?.message?.content || 'Unable to process the search results.';
      
      return NextResponse.json({ 
        response: finalResponse,
        usage: {
          prompt_tokens: (completion.usage?.prompt_tokens || 0) + (secondCompletion.usage?.prompt_tokens || 0),
          completion_tokens: (completion.usage?.completion_tokens || 0) + (secondCompletion.usage?.completion_tokens || 0),
          total_tokens: (completion.usage?.total_tokens || 0) + (secondCompletion.usage?.total_tokens || 0)
        },
        functionCalled: true,
        searchQuery: searchQuery,
        resultsCount: resultsCount
      });
    }

    // No function call - return regular response
    const response = message?.content || 'No response generated';

    return NextResponse.json({ 
      response,
      usage: completion.usage,
      functionCalled: false
    });

  } catch (error) {
    console.error('❌ Unexpected error in API route:', error);
    
    // More specific error handling
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
} 