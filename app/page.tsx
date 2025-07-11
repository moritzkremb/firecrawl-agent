'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'assistant',
      content: 'Hello! I can help you scrape information from websites. Just ask me what you\'d like to know and I\'ll search for the most relevant information.',
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Format time consistently to avoid hydration mismatches
  const formatTime = (date: Date) => {
    if (!isClient) return '';
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true
    });
  };

  // Format message content with proper links and structure
  const formatMessageContent = (content: string, messageType: 'user' | 'assistant' = 'assistant') => {
    if (!content) return '';

    // Define link colors based on message type
    const linkClasses = messageType === 'user' 
      ? 'text-blue-100 hover:text-white underline break-all' 
      : 'text-blue-600 hover:text-blue-800 underline break-all';

    // Split content by lines
    const lines = content.split('\n');
    
    return lines.map((line, lineIndex) => {
      // Skip empty lines
      if (!line.trim()) {
        return <br key={lineIndex} />;
      }

      // Handle function call indicators (lines starting with icons)
      if (line.match(/^[🕷️🔍]/)) {
        return (
          <div key={lineIndex} className="mb-3 p-2 bg-blue-50 rounded-lg border-l-4 border-blue-400">
            <span className="text-blue-700 font-medium text-xs">{line}</span>
          </div>
        );
      }

      // Handle numbered list items
      if (line.match(/^\d+\.\s/)) {
        const parts = line.split(/(\(https?:\/\/[^\s)]+\))/g);
        return (
          <div key={lineIndex} className="mb-2 ml-4">
            <span className="font-medium">
              {parts.map((part, partIndex) => {
                if (part.match(/^\(https?:\/\/[^\s)]+\)$/)) {
                  const url = part.slice(1, -1); // Remove parentheses
                  return (
                    <a
                      key={partIndex}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={linkClasses}
                    >
                      (link)
                    </a>
                  );
                }
                return part;
              })}
            </span>
          </div>
        );
      }

      // Handle regular content with URL detection
      const urlRegex = /(https?:\/\/[^\s)]+)/g;
      const parts = line.split(urlRegex);
      
      return (
        <div key={lineIndex} className="mb-2">
          {parts.map((part, partIndex) => {
            if (part.match(urlRegex)) {
              return (
                <a
                  key={partIndex}
                  href={part}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClasses}
                >
                  {part}
                </a>
              );
            }
            return <span key={partIndex} className="break-words">{part}</span>;
          })}
        </div>
      );
    });
  };

  // Set client flag after hydration
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // Step 3: Call OpenAI API with conversation history
      const conversationMessages = [...messages, userMessage].map(msg => ({
        role: msg.type === 'user' ? 'user' as const : 'assistant' as const,
        content: msg.content
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: conversationMessages
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error Response:', errorText);
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      // Check if response has content before parsing
      const responseText = await response.text();
      if (!responseText || responseText.trim() === '') {
        throw new Error('Empty response from server');
      }

      let data;
      try {
        console.log('🔍 Attempting to parse response:', responseText.substring(0, 200) + '...');
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('JSON Parse Error:', parseError);
        console.error('Response text that failed to parse:', responseText);
        console.error('Response type:', typeof responseText);
        console.error('Response length:', responseText.length);
        throw new Error(`Invalid JSON response from server. Response: "${responseText.substring(0, 100)}..."`);
      }
      
      let content = data.response || 'Sorry, I couldn\'t generate a response.';
      
      // Add function call indicator for search
      if (data.functionCalled && data.searchQuery) {
        const isSpecificSite = data.searchQuery.includes('site:');
        const icon = isSpecificSite ? '🕷️' : '🔍';
        const action = isSpecificSite ? 'Searched site' : 'Web search';
        content = `${icon} *${action}: "${data.searchQuery}" (${data.resultsCount || 0} results)*\n\n${content}`;
      }
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: content,
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto max-w-5xl h-screen flex flex-col p-4 overflow-hidden">
        {/* Header */}
        <Card className="mb-4 p-6 bg-white/80 backdrop-blur-sm border-0 shadow-lg">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Bot className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Web Research Assistant</h1>
              <p className="text-slate-600">Ask me anything and I'll search the web for answers</p>
            </div>
          </div>
        </Card>

        {/* Chat Messages */}
        <Card className="flex-1 mb-4 bg-white/80 backdrop-blur-sm border-0 shadow-lg overflow-hidden">
          <ScrollArea ref={scrollAreaRef} className="h-full p-6">
            <div className="space-y-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex items-start space-x-3 animate-in slide-in-from-bottom-2 duration-300 ${
                    message.type === 'user' ? 'flex-row-reverse space-x-reverse justify-start' : 'justify-start'
                  }`}
                >
                  <div className={`p-2 rounded-lg shrink-0 ${
                    message.type === 'user' 
                      ? 'bg-blue-100 text-blue-600' 
                      : 'bg-slate-100 text-slate-600'
                  }`}>
                    {message.type === 'user' ? (
                      <User className="h-5 w-5" />
                    ) : (
                      <Bot className="h-5 w-5" />
                    )}
                  </div>
                  <div className={`min-w-0 max-w-[85%] ${message.type === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'}`}>
                    <div className={`p-4 rounded-2xl break-words inline-block ${
                      message.type === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-800'
                    }`}>
                      <div className="text-sm leading-relaxed overflow-hidden">
                        {formatMessageContent(message.content, message.type)}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-2 px-2">
                      {formatTime(message.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
              
              {/* Loading indicator */}
              {isLoading && (
                <div className="flex items-start space-x-3 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="p-2 bg-slate-100 rounded-lg text-slate-600">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="bg-slate-100 p-4 rounded-2xl">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* Input Area */}
        <Card className="p-4 bg-white/80 backdrop-blur-sm border-0 shadow-lg">
          <div className="flex items-end space-x-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Ask me to research anything...
              </label>
              <textarea
                ref={inputRef}
                placeholder="Type your question here (e.g., 'Find 3 companies on LinkedIn that are in Berlin and operate in the AI space')"
                value={inputValue}
                onChange={(e) => {
                  if (e.target.value.length <= 1000) {
                    setInputValue(e.target.value);
                  }
                }}
                onKeyPress={handleKeyPress}
                disabled={isLoading}
                rows={3}
                maxLength={1000}
                className="w-full p-3 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-none transition-all duration-200 text-sm leading-relaxed bg-white"
              />
            </div>
            <Button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transition-all duration-200 self-end h-fit"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="mt-3 text-xs text-slate-500 flex items-center justify-between">
            <span>Press Enter to send • Shift + Enter for new line</span>
            <span className="text-slate-400">
              {inputValue.length}/1000
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}