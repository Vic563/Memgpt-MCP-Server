#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import sqlite3 from 'sqlite3';
import { Database } from 'sqlite3';
import axios from 'axios';
import * as dotenv from 'dotenv';
import { promisify } from 'util';

dotenv.config();

interface Memory {
  id: number;
  userId: string;
  prompt: string;
  response: string;
  timestamp: string;
  provider: string;
}

class LettaMemGPTServer {
  private server: Server;
  private db!: Database;
  private openaiKey: string;
  private anthropicKey: string;
  private openrouterKey: string;

  private async initialize() {
    const dbPath = '/Users/victor/Documents/Cline/MCP/letta-server/data/memory.db';
    try {
      const fs = await import('fs/promises');
      await fs.mkdir('/Users/victor/Documents/Cline/MCP/letta-server/data', { recursive: true });
    } catch (error) {
      // Ignore if directory already exists
    }
    this.db = new sqlite3.Database(dbPath);
    await this.initializeDatabase();
  }

  constructor() {
    this.server = new Server(
      {
        name: 'letta-memgpt',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize API keys from environment variables
    this.openaiKey = process.env.OPENAI_API_KEY || '';
    this.anthropicKey = process.env.ANTHROPIC_API_KEY || '';
    this.openrouterKey = process.env.OPENROUTER_API_KEY || '';

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private DEFAULT_USER = 'default_user';
  private currentProvider = 'openai';
  private currentModel = {
    openai: 'gpt-3.5-turbo',
    openrouter: 'openai/gpt-3.5-turbo',
    anthropic: 'claude-2',
    ollama: 'llama3.3:latest'
  };
  private settingsPath = '/Users/victor/Library/Application Support/Cursor/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json';

  private async updateSettingsFile(provider: string) {
    try {
      const fs = await import('fs/promises');
      const settingsContent = await fs.readFile(this.settingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);
      
      if (settings.mcpServers['letta-memgpt']) {
        settings.mcpServers['letta-memgpt'].defaultProvider = provider;
        await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
      }
    } catch (error: any) {
      console.error('Failed to update settings file:', error?.message);
    }
  }

  private async readSettingsFile() {
    try {
      const fs = await import('fs/promises');
      const settingsContent = await fs.readFile(this.settingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);
      
      if (settings.mcpServers['letta-memgpt']?.defaultProvider) {
        this.currentProvider = settings.mcpServers['letta-memgpt'].defaultProvider;
      }
    } catch (error: any) {
      console.error('Failed to read settings file:', error?.message);
    }
  }

  private async initializeDatabase() {
    await this.readSettingsFile();
    await new Promise<void>((resolve, reject) => {
      this.db.serialize(() => {
        // Create memory table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT DEFAULT 'default_user',
            prompt TEXT NOT NULL,
            response TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            provider TEXT NOT NULL
          )
        `);

        // Create settings table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    // Initialize or get current provider
    await new Promise<void>((resolve, reject) => {
      this.db.get(
        'SELECT value FROM settings WHERE key = ?',
        ['current_provider'],
        (err, row: any) => {
          if (err) {
            reject(err);
          } else if (row) {
            this.currentProvider = row.value;
            resolve();
          } else {
            this.db.run(
              'INSERT INTO settings (key, value) VALUES (?, ?)',
              ['current_provider', this.currentProvider],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          }
        }
      );
    });
  }

  private async cleanup() {
    await promisify(this.db.close.bind(this.db))();
    await this.server.close();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'chat',
          description: 'Send a message to the current LLM provider',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'The message to send to the LLM',
              }
            },
            required: ['message'],
          },
        },
        {
          name: 'get_memory',
          description: 'Retrieve conversation history',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of memories to retrieve',
              },
            },
          },
        },
        {
          name: 'clear_memory',
          description: 'Clear conversation history',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'use_provider',
          description: 'Switch to a different LLM provider',
          inputSchema: {
            type: 'object',
            properties: {
              provider: {
                type: 'string',
                description: 'The LLM provider to use (openai, anthropic, openrouter, or ollama)',
              },
            },
            required: ['provider'],
          },
        },
        {
          name: 'use_model',
          description: 'Switch to a different model for the current provider',
          inputSchema: {
            type: 'object',
            properties: {
              model: {
                type: 'string',
                description: 'The model to use. For OpenAI: gpt-4o, gpt-4o-mini, gpt-4-turbo. For OpenRouter: openai/gpt-4, anthropic/claude-2, etc. For Ollama: llama2, codellama, etc.',
              },
            },
            required: ['model'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'chat':
          return this.handleChat(request.params.arguments);
        case 'get_memory':
          return this.handleGetMemory(request.params.arguments);
        case 'clear_memory':
          return this.handleClearMemory();
        case 'use_provider':
          return this.handleUseProvider(request.params.arguments);
        case 'use_model':
          return this.handleUseModel(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  private async handleUseProvider(args: any) {
    if (!args.provider) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameter: provider'
      );
    }

    const validProviders = ['openai', 'anthropic', 'openrouter', 'ollama'];
    if (!validProviders.includes(args.provider)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid provider. Must be one of: ${validProviders.join(', ')}`
      );
    }

    // Update provider in memory, database, and settings file
    this.currentProvider = args.provider;
    
    // Update database
    await new Promise<void>((resolve, reject) => {
      this.db.run(
        'UPDATE settings SET value = ?, lastUpdated = CURRENT_TIMESTAMP WHERE key = ?',
        [args.provider, 'current_provider'],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Update settings file
    await this.updateSettingsFile(args.provider);

    return {
      content: [
        {
          type: 'text',
          text: `Now using ${args.provider} as the LLM provider (saved to settings)`,
        },
      ],
    };
  }

  private async handleChat(args: any) {
    if (!args.message) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameter: message'
      );
    }

    let response: string;
    try {
      switch (this.currentProvider) {
        case 'openai':
          response = await this.queryOpenAI(args.message);
          break;
        case 'anthropic':
          response = await this.queryAnthropic(args.message);
          break;
        case 'openrouter':
          response = await this.queryOpenRouter(args.message);
          break;
        case 'ollama':
          response = await this.queryOllama(args.message);
          break;
        default:
          throw new McpError(
            ErrorCode.InvalidParams,
            `Unsupported provider: ${args.provider}`
          );
      }

      // Store the interaction in memory
      await this.storeMemory(args.message, response, this.currentProvider);

      return {
        content: [
          {
            type: 'text',
            text: response,
          },
        ],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Error querying ${args.provider}: ${error?.message || 'Unknown error'}`
      );
    }
  }

  private async handleGetMemory(args: any) {
    const memories: Memory[] = await new Promise((resolve, reject) => {
      const query = args.limit === null
        ? 'SELECT * FROM memory ORDER BY timestamp DESC'
        : 'SELECT * FROM memory ORDER BY timestamp DESC LIMIT ?';
      const params = args.limit === null ? [] : [args.limit || 10];
      this.db.all(
        query,
        params,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows as Memory[]);
        }
      );
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(memories, null, 2),
        },
      ],
    };
  }

  private async handleClearMemory() {
    await new Promise<void>((resolve, reject) => {
      this.db.run('DELETE FROM memory', [], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Memory cleared',
        },
      ],
    };
  }

  private async handleUseModel(args: any) {
    if (!args.model) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameter: model'
      );
    }

    try {
      // Validate model based on current provider
      switch (this.currentProvider) {
        case 'openai':
          const openaiModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
          if (!openaiModels.includes(args.model)) {
            throw new Error(`Invalid OpenAI model. Available models: ${openaiModels.join(', ')}`);
          }
          break;

        case 'openrouter':
          // OpenRouter supports various models from different providers
          if (!args.model.includes('/')) {
            throw new Error('OpenRouter model must be in format: provider/model (e.g., openai/gpt-4, anthropic/claude-2)');
          }
          break;

        case 'ollama':
          try {
            const modelResponse = await axios.get('http://localhost:11434/api/tags');
            const availableModels = modelResponse.data.models || [];
            if (!availableModels.some((m: any) => m.name === args.model)) {
              throw new Error(`Model ${args.model} not found. Available models: ${availableModels.map((m: any) => m.name).join(', ')}`);
            }
          } catch (error: any) {
            if (error.code === 'ECONNREFUSED') {
              throw new Error('Ollama is not running. Please start Ollama first (https://ollama.ai)');
            }
            throw error;
          }
          break;

        case 'anthropic':
          const anthropicModels = [
            'claude-3-haiku',
            'claude-3-sonnet',
            'claude-3-opus',
            'claude-3.5-haiku',
            'claude-3.5-sonnet'
          ];
          if (!anthropicModels.includes(args.model)) {
            throw new Error(`Invalid Anthropic model. Available models: ${anthropicModels.join(', ')}`);
          }
          break;

        default:
          throw new Error(`Cannot set model for provider: ${this.currentProvider}`);
      }

      // Update current model
      this.currentModel[this.currentProvider] = args.model;

      // Update settings file
      const fs = await import('fs/promises');
      const settingsContent = await fs.readFile(this.settingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);
      
      if (settings.mcpServers['letta-memgpt']) {
        if (!settings.mcpServers['letta-memgpt'].models) {
          settings.mcpServers['letta-memgpt'].models = {};
        }
        settings.mcpServers['letta-memgpt'].models[this.currentProvider] = args.model;
        await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
      }

      return {
        content: [
          {
            type: 'text',
            text: `Now using ${args.model} with ${this.currentProvider}`,
          },
        ],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        error.message || 'Failed to set model'
      );
    }
  }

  private async storeMemory(
    prompt: string,
    response: string,
    provider: string
  ) {
    await new Promise<void>((resolve, reject) => {
      this.db.run(
        'INSERT INTO memory (userId, prompt, response, provider) VALUES (?, ?, ?, ?)',
        [this.DEFAULT_USER, prompt, response, provider],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  private async queryOpenAI(message: string): Promise<string> {
    if (!this.openaiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: this.currentModel.openai,
        messages: [{ role: 'user', content: message }],
      },
      {
        headers: {
          'Authorization': `Bearer ${this.openaiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.choices[0].message.content;
  }

  private async queryAnthropic(message: string): Promise<string> {
    if (!this.anthropicKey) {
      throw new Error('Anthropic API key not configured');
    }

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: this.currentModel.anthropic,
        messages: [{ role: 'user', content: message }],
      },
      {
        headers: {
          'x-api-key': this.anthropicKey,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.content[0].text;
  }

  private async queryOpenRouter(message: string): Promise<string> {
    if (!this.openrouterKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: this.currentModel.openrouter,
        messages: [{ role: 'user', content: message }],
      },
      {
        headers: {
          'Authorization': `Bearer ${this.openrouterKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.choices[0].message.content;
  }

  private async queryOllama(message: string): Promise<string> {
    try {
      // Check if Ollama is running and model exists
      try {
        const modelResponse = await axios.get('http://localhost:11434/api/tags');
        const availableModels = modelResponse.data.models || [];
        if (!availableModels.some((m: any) => m.name === this.currentModel.ollama)) {
          throw new Error(`Model ${this.currentModel.ollama} not found. Available models: ${availableModels.map((m: any) => m.name).join(', ')}`);
        }
      } catch (error: any) {
        if (error.code === 'ECONNREFUSED') {
          throw new Error('Ollama is not running. Please start Ollama first (https://ollama.ai)');
        }
        throw error;
      }

      // Use axios to get the streaming response
      const response = await axios.post('http://localhost:11434/api/generate', {
        model: this.currentModel.ollama,
        prompt: message,
        stream: false  // Disable streaming to get complete response
      });

      // Extract the response text
      if (response.data && response.data.response) {
        return response.data.response;
      }

      throw new Error('No response received from Ollama');
    } catch (error: any) {
      throw new Error(`Ollama error: ${error?.message || 'Unknown error'}`);
    }
  }

  async run() {
    await this.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Letta MemGPT MCP server running on stdio');
  }
}

const server = new LettaMemGPTServer();
server.run().catch(console.error);
