import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Bot, User, Sparkles, RefreshCw, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const SUGGESTED_QUESTIONS = [
  "How many casual leaves am I entitled to?",
  "What is the gratuity calculation formula?",
  "How does the Flexi Hours policy work?",
  "What is the maternity leave duration?",
  "What expenses are covered under travel policy?",
];

const AI_UNAVAILABLE_PHRASES = [
  'cannot reach ollama',
  'ollama',
  'model not found',
  'currently unavailable',
  'please contact hr directly',
  'groq_api_key',
];

function isAiUnavailableMessage(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return AI_UNAVAILABLE_PHRASES.some(p => lower.includes(p));
}

export default function AskMax() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Hi! I'm **AskMax**, your HR assistant at Maxvolt Energy. I can help you understand company policies on leave, travel, gratuity, uniform, and more. What would you like to know?"
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState(null); // null | 'ok' | 'unavailable'
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (question) => {
    const userQuestion = question || input.trim();
    if (!userQuestion || loading) return;

    const newMessages = [...messages, { role: 'user', content: userQuestion }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    const conversationHistory = newMessages.slice(1);

    try {
      const response = await base44.functions.invoke('askMax', {
        question: userQuestion,
        conversationHistory
      });

      const answer = response.data?.answer || 'Sorry, I could not get a response. Please try again.';
      const unavailable = isAiUnavailableMessage(answer);
      setAiStatus(unavailable ? 'unavailable' : 'ok');

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: unavailable
          ? "I'm currently being set up and will be ready soon. In the meantime, please contact HR directly for policy questions."
          : answer
      }]);
    } catch {
      setAiStatus('unavailable');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Something went wrong. Please check your connection and try again.'
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const resetChat = () => {
    setMessages([{
      role: 'assistant',
      content: "Hi! I'm **AskMax**, your HR assistant at Maxvolt Energy. I can help you understand company policies on leave, travel, gratuity, uniform, and more. What would you like to know?"
    }]);
    setInput('');
    setAiStatus(null);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">AskMax</h1>
            <p className="text-xs text-muted-foreground">Maxvolt Energy HR Assistant</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={resetChat} className="text-muted-foreground gap-2">
          <RefreshCw className="w-4 h-4" />
          New Chat
        </Button>
      </div>

      {/* AI unavailable banner */}
      {aiStatus === 'unavailable' && (
        <div className="mx-4 mt-3 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 dark:bg-yellow-50 dark:border-amber-200 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-700 dark:text-yellow-600">
            AI assistant is warming up — it may take a few minutes on first use. Contact HR directly for urgent queries.
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-sm'
                  : 'bg-card border border-border text-foreground rounded-tl-sm shadow-sm'
              }`}>
                {msg.role === 'user' ? (
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                ) : (
                  <ReactMarkdown
                    className="text-sm max-w-none"
                    components={{
                      p:      ({ children }) => <p className="my-1 leading-relaxed text-foreground">{children}</p>,
                      ul:     ({ children }) => <ul className="my-1 ml-4 list-disc text-foreground">{children}</ul>,
                      ol:     ({ children }) => <ol className="my-1 ml-4 list-decimal text-foreground">{children}</ol>,
                      li:     ({ children }) => <li className="my-0.5 text-foreground">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                      code:   ({ children }) => <code className="bg-muted text-foreground px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
                      h1:     ({ children }) => <h1 className="text-base font-bold text-foreground mt-3 mb-1">{children}</h1>,
                      h2:     ({ children }) => <h2 className="text-sm font-bold text-foreground mt-2 mb-1">{children}</h2>,
                      h3:     ({ children }) => <h3 className="text-sm font-semibold text-foreground mt-2 mb-1">{children}</h3>,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                <div className="flex gap-1 items-center h-5">
                  <div className="w-2 h-2 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Suggested Questions (only show initially) */}
      {messages.length <= 1 && (
        <div className="px-4 pb-3">
          <div className="max-w-3xl mx-auto">
            <p className="text-xs text-muted-foreground mb-2 text-center">Suggested questions</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTED_QUESTIONS.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => sendMessage(q)}
                  className="text-xs bg-card border border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400 rounded-full px-3 py-1.5 hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="bg-card border-t border-border px-4 py-4">
        <div className="max-w-3xl mx-auto flex gap-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me about company policies..."
            disabled={loading}
            className="flex-1 rounded-full border-border focus:border-orange-400"
          />
          <Button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="rounded-full w-10 h-10 p-0 bg-orange-500 hover:bg-orange-600 text-white"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">AskMax can make mistakes. Verify important policy details with HR.</p>
      </div>
    </div>
  );
}
