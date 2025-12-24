/**
 *----------------------------------------------------------------------------
 * File:       web-search.js
 * Project:    claude-flow
 * Created by: Celaya Solutions, 2025
 * Author:     Christopher Celaya <chris@chriscelaya.com>
 * Description: Web search utility for Ollama integration
 * Version:     1.0.0
 * License:    MIT
 * Last Update: November 2025
 *----------------------------------------------------------------------------
 */

/**
 * Web Search Utility for Ollama Integration
 * Provides web search capabilities using DuckDuckGo or other search engines
 */

/**
 * Perform web search using DuckDuckGo (no API key required)
 * Falls back to Perplexity API if PERPLEXITY_API_KEY is set
 */
export async function searchWeb(query, options = {}) {
  const { limit = 10, region = 'us-en' } = options;
  
  // Try Perplexity API first if available (better results)
  if (process.env.PERPLEXITY_API_KEY) {
    try {
      return await searchWithPerplexity(query, { limit });
    } catch (error) {
      console.warn('Perplexity search failed, falling back to DuckDuckGo:', error.message);
    }
  }
  
  // Fallback to DuckDuckGo (no API key needed)
  try {
    // Use DuckDuckGo HTML search (no API key needed)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Parse HTML to extract results
    const results = parseDuckDuckGoResults(html, limit);
    
    return {
      query,
      results,
      total: results.length,
      timestamp: new Date().toISOString(),
      source: 'duckduckgo',
    };
  } catch (error) {
    console.error('Web search error:', error);
    
    // Fallback: return empty results with error message
    return {
      query,
      results: [],
      total: 0,
      error: error.message,
      timestamp: new Date().toISOString(),
      source: 'none',
    };
  }
}

/**
 * Search using Perplexity API (better quality results)
 */
async function searchWithPerplexity(query, options = {}) {
  const { limit = 10 } = options;
  const apiKey = process.env.PERPLEXITY_API_KEY;
  
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY not set');
  }
  
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-sonar-small-128k-online',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that provides web search results in a structured format.',
        },
        {
          role: 'user',
          content: `Search the web for: ${query}. Provide ${limit} results with titles, URLs, and snippets.`,
        },
      ],
      max_tokens: 2000,
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error: ${response.statusText} - ${errorText}`);
  }
  
  const data = await response.json();
  const content = data.choices[0]?.message?.content || '';
  
  // Parse Perplexity response (it includes citations)
  const results = parsePerplexityResults(content, limit);
  
  return {
    query,
    results,
    total: results.length,
    timestamp: new Date().toISOString(),
    source: 'perplexity',
  };
}

/**
 * Parse Perplexity API response
 */
function parsePerplexityResults(content, limit) {
  const results = [];
  
  // Perplexity includes citations in format [1], [2], etc.
  const citationRegex = /\[(\d+)\]\s*(.+?)(?=\[|$)/g;
  const urlRegex = /https?:\/\/[^\s\)]+/g;
  
  let match;
  let rank = 1;
  
  while ((match = citationRegex.exec(content)) !== null && results.length < limit) {
    const citationText = match[2].trim();
    const urlMatch = citationText.match(urlRegex);
    
    if (urlMatch && urlMatch[0]) {
      // Extract title (text before URL)
      const titleMatch = citationText.split(urlMatch[0])[0].trim();
      const snippetMatch = citationText.split(urlMatch[0])[1]?.trim() || '';
      
      results.push({
        title: titleMatch || `Result ${rank}`,
        url: urlMatch[0],
        snippet: snippetMatch.substring(0, 200),
        rank: rank++,
      });
    }
  }
  
  return results;
}

/**
 * Parse DuckDuckGo HTML results
 * Improved parsing with multiple fallback strategies
 */
function parseDuckDuckGoResults(html, limit) {
  const results = [];
  
  try {
    // Strategy 1: Try modern DuckDuckGo structure
    const modernRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]*)<\/a>/gi;
    
    const links = [];
    let match;
    while ((match = modernRegex.exec(html)) !== null && links.length < limit * 2) {
      const url = match[1];
      // Skip internal DuckDuckGo URLs
      if (!url.includes('duckduckgo.com') && url.startsWith('http')) {
        links.push({
          url: url,
          title: match[2].trim().replace(/<[^>]+>/g, ''),
        });
      }
    }
    
    const snippets = [];
    while ((match = snippetRegex.exec(html)) !== null && snippets.length < limit * 2) {
      snippets.push(match[1].trim().replace(/<[^>]+>/g, ''));
    }
    
    // Strategy 2: Fallback to generic result parsing
    if (links.length === 0) {
      const genericLinkRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
      while ((match = genericLinkRegex.exec(html)) !== null && links.length < limit * 2) {
        const url = match[1];
        if (!url.includes('duckduckgo.com') && !url.includes('javascript:')) {
          links.push({
            url: url,
            title: match[2].trim().replace(/<[^>]+>/g, ''),
          });
        }
      }
    }
    
    // Combine links and snippets, matching by proximity
    for (let i = 0; i < Math.min(links.length, limit); i++) {
      const link = links[i];
      const snippet = snippets[i] || snippets[i - 1] || '';
      
      // Clean up URLs (remove tracking parameters)
      const cleanUrl = link.url.split('&')[0].split('?')[0];
      
      results.push({
        title: link.title || `Result ${i + 1}`,
        url: cleanUrl,
        snippet: snippet.substring(0, 300),
        rank: i + 1,
      });
    }
  } catch (error) {
    console.error('Error parsing search results:', error);
  }
  
  return results;
}

/**
 * Enhanced web search with multiple queries
 */
export async function searchWebMultiple(queries, options = {}) {
  const results = await Promise.all(
    queries.map(query => searchWeb(query, options))
  );
  
  return {
    queries,
    results,
    totalResults: results.reduce((sum, r) => sum + r.total, 0),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Search and fetch content from top results
 */
export async function searchAndFetch(query, options = {}) {
  const { fetchCount = 3 } = options;
  
  // First, search
  const searchResults = await searchWeb(query, { limit: fetchCount });
  
  // Then fetch content from top results
  const fetchedContent = [];
  
  for (const result of searchResults.results.slice(0, fetchCount)) {
    try {
      const content = await fetchWebPage(result.url);
      fetchedContent.push({
        ...result,
        content: content.substring(0, 5000), // Limit content size
      });
    } catch (error) {
      // Continue if fetch fails
      fetchedContent.push({
        ...result,
        content: null,
        fetchError: error.message,
      });
    }
  }
  
  return {
    query,
    searchResults: searchResults.results,
    fetchedContent,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Fetch web page content
 */
async function fetchWebPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Extract text content (simple extraction)
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    return textContent.substring(0, 10000); // Limit to 10k chars
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

