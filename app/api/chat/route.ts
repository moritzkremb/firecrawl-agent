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
    name: "scrape_website",
    description: "Scrape content from a website URL and convert it to markdown. Use this when the user asks about information from a specific website or URL.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The website URL to scrape (must include http:// or https://)"
        },
        formats: {
          type: "array",
          items: {
            type: "string",
            enum: ["markdown", "html"]
          },
          description: "Output formats to return",
          default: ["markdown"]
        }
      },
      required: ["url"]
    }
  }
];

// Step 4: Firecrawl API integration function
async function scrapeWithFirecrawl(url: string, formats: string[] = ['markdown']) {
  try {
    console.log(`🕷️ Scraping ${url} with Firecrawl...`);
    
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error('Firecrawl API key not configured');
    }

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`
      },
      body: JSON.stringify({
        url: url,
        formats: formats
      })
    });

    if (!response.ok) {
      throw new Error(`Firecrawl API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Successfully scraped ${url}`);
    
    if (data.success && data.data) {
      return {
        success: true,
        url: url,
        title: data.data.metadata?.title || 'No title',
        markdown: data.data.markdown || 'No content available',
        metadata: data.data.metadata || {}
      };
    } else {
      throw new Error('Firecrawl returned unsuccessful response');
    }
    
  } catch (error) {
    console.error(`❌ Error scraping ${url}:`, error);
    return {
      success: false,
      url: url,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      markdown: `Failed to scrape ${url}. Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    // Enhanced debugging
    console.log('🔍 API Key exists:', !!process.env.OPENAI_API_KEY);
    console.log('📝 Messages received:', messages?.length || 0);

    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ OpenAI API key not found in environment variables');
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to your .env.local file.' },
        { status: 500 }
      );
    }

    // Step 2: Chat completion WITH function calling
    console.log('🚀 Making OpenAI API call with GPT-4o-mini and function calling...');
    const completion = await openai.chat.completions.create({
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

    const message = completion.choices[0]?.message;
    
    // Step 3: Check if OpenAI wants to call a function
    if (message?.tool_calls && message.tool_calls.length > 0) {
      console.log('🔧 Function call requested:', message.tool_calls[0].function.name);
      
      const toolCall = message.tool_calls[0];
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);
      
      if (functionName === 'scrape_website') {
        // Step 4: Execute the Firecrawl API call
        const scrapedData = await scrapeWithFirecrawl(functionArgs.url, functionArgs.formats || ['markdown']);
        
        // Step 5: Send function result back to OpenAI
        const secondCompletion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            ...messages,
            message,
            {
              role: "tool",
              content: JSON.stringify(scrapedData),
              tool_call_id: toolCall.id
            }
          ],
          temperature: 0.7,
          max_tokens: 1500,
        });
        
        const finalResponse = secondCompletion.choices[0]?.message?.content || 'Unable to process the scraped data.';
        
        return NextResponse.json({ 
          response: finalResponse,
          usage: {
            prompt_tokens: (completion.usage?.prompt_tokens || 0) + (secondCompletion.usage?.prompt_tokens || 0),
            completion_tokens: (completion.usage?.completion_tokens || 0) + (secondCompletion.usage?.completion_tokens || 0),
            total_tokens: (completion.usage?.total_tokens || 0) + (secondCompletion.usage?.total_tokens || 0)
          },
          functionCalled: true,
          scrapedUrl: functionArgs.url
        });
      }
    }

    // No function call - return regular response
    const response = message?.content || 'No response generated';

    return NextResponse.json({ 
      response,
      usage: completion.usage,
      functionCalled: false
    });

  } catch (error) {
    console.error('❌ OpenAI API error details:', error);
    
    // More specific error handling
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    
    return NextResponse.json(
      { 
        error: 'Failed to generate response', 
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 