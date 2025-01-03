# MemGPT MCP Server

A TypeScript-based MCP server that implements a memory system for LLMs. It provides tools for chatting with different LLM providers while maintaining conversation history.

## Features

### Tools
- `chat` - Send a message to the current LLM provider
  - Takes a message parameter
  - Supports multiple providers (OpenAI, Anthropic, OpenRouter, Ollama)

- `get_memory` - Retrieve conversation history
  - Optional `limit` parameter to specify number of memories to retrieve
  - Pass `limit: null` for unlimited memory retrieval
  - Returns memories in chronological order with timestamps

- `clear_memory` - Clear conversation history
  - Removes all stored memories

- `use_provider` - Switch between different LLM providers
  - Supports OpenAI, Anthropic, OpenRouter, and Ollama
  - Persists provider selection

- `use_model` - Switch to a different model for the current provider
  - Supports provider-specific models (e.g., GPT-4, Claude-2, etc.)
  - Persists model selection

## Development

Install dependencies:
```bash
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

## Installation

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "letta-memgpt": {
      "command": "/path/to/memgpt-server/build/index.js",
      "env": {
        "OPENAI_API_KEY": "your-openai-key",
        "ANTHROPIC_API_KEY": "your-anthropic-key",
        "OPENROUTER_API_KEY": "your-openrouter-key"
      }
    }
  }
}
```

### Environment Variables
- `OPENAI_API_KEY` - Your OpenAI API key
- `ANTHROPIC_API_KEY` - Your Anthropic API key
- `OPENROUTER_API_KEY` - Your OpenRouter API key

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

## Recent Updates

### Unlimited Memory Retrieval
- Added support for retrieving unlimited conversation history
- Use `{ "limit": null }` with the `get_memory` tool to retrieve all stored memories
- Use `{ "limit": n }` to retrieve the n most recent memories
- Default limit is 10 if not specified
